import { addHours, subMinutes } from "date-fns";
import type { InferAttributes, InferCreationAttributes } from "sequelize";
import { Op } from "sequelize";
import {
  Column,
  Table,
  Unique,
  BeforeValidate,
  BelongsTo,
  ForeignKey,
  IsDate,
  DataType,
  AfterFind,
  BeforeSave,
  Scopes,
} from "sequelize-typescript";
import { randomString } from "@shared/random";
import { ApiKeyValidation } from "@shared/validations";
import type { APIContext } from "@server/types";
import { hash } from "@server/utils/crypto";
import User from "./User";
import ParanoidModel from "./base/ParanoidModel";
import { SkipChangeset } from "./decorators/Changeset";
import AuthenticationHelper from "@shared/helpers/AuthenticationHelper";
import IsScope from "./validators/IsScope";
import Length from "./validators/Length";

@Table({ tableName: "apiKeys", modelName: "apiKey" })
@Scopes(() => ({
  withUser: {
    include: [
      {
        association: "user",
      },
    ],
  },
}))
class ApiKey extends ParanoidModel<
  InferAttributes<ApiKey>,
  Partial<InferCreationAttributes<ApiKey>>
> {
  static prefix = "ol_api_";

  static eventNamespace = "api_keys";

  /** The human-readable name of this API key */
  @Length({
    min: ApiKeyValidation.minNameLength,
    max: ApiKeyValidation.maxNameLength,
    msg: `Name must be between ${ApiKeyValidation.minNameLength} and ${ApiKeyValidation.maxNameLength} characters`,
  })
  @Column(DataType.STRING)
  name: string;

  /** A list of scopes that this API key has access to */
  @IsScope
  @Column(DataType.ARRAY(DataType.STRING))
  scope: string[] | null;

  /** @deprecated The plain text value of the API key, removed soon. */
  @Unique
  @Column(DataType.STRING)
  secret: string;

  /** The cached plain text value. Only available when creating the API key */
  @Column(DataType.VIRTUAL)
  value: string | null;

  /** The hashed value of the API key */
  @Unique
  @Column(DataType.STRING)
  @SkipChangeset
  hash: string;

  /** The last 4 characters of the API key */
  @Column(DataType.STRING)
  @SkipChangeset
  last4: string;

  /**
   * The hashed value of the secret that was replaced when this key was last
   * regenerated. Retained to honor a grace period, and never returned to a
   * client.
   */
  @Unique
  @Column(DataType.STRING)
  @SkipChangeset
  previousHash: string | null;

  /** The date and time when the previous secret stops authenticating */
  @IsDate
  @Column(DataType.DATE)
  @SkipChangeset
  previousHashExpiresAt: Date | null;

  /** The date and time when this API key will expire */
  @IsDate
  @Column(DataType.DATE)
  expiresAt: Date | null;

  /** The date and time when this API key was last used */
  @IsDate
  @Column(DataType.DATE)
  @SkipChangeset
  lastActiveAt: Date | null;

  // hooks

  @AfterFind
  public static async afterFindHook(models: ApiKey | ApiKey[]) {
    const modelsArray = Array.isArray(models) ? models : [models];
    for (const model of modelsArray) {
      if (model?.secret) {
        model.last4 = model.secret.slice(-4);
      }
    }
  }

  @BeforeValidate
  public static async generateSecret(model: ApiKey) {
    if (!model.hash) {
      model.value = model.secret || ApiKey.createSecret();
      model.hash = hash(model.value);
    }
  }

  @BeforeSave
  public static async updateLast4(model: ApiKey) {
    const value = model.value || model.secret;
    if (value) {
      model.last4 = value.slice(-4);
    }
  }

  /**
   * Creates a new plain-text API key secret.
   *
   * @returns the secret, including the prefix used to identify API keys.
   */
  private static createSecret() {
    return `${ApiKey.prefix}${randomString(38)}`;
  }

  /**
   * Validates that the input text _could_ be an API key, this does not check
   * that the key actually exists in the database.
   *
   * @param text The text to validate
   * @returns True if likely an API key
   */
  public static match(text: string) {
    // cannot guarantee prefix here as older keys do not include it.
    return !!text.replace(ApiKey.prefix, "").match(/^[\w]{38}$/);
  }

  /**
   * Finds an API key by the given input string. This will check the secret,
   * the hash, and the previous hash while it is still within its grace period.
   *
   * @param input The input string to search for
   * @returns The API key if found
   */
  public static findByToken(input: string) {
    const hashed = hash(input);
    return this.findOne({
      where: {
        [Op.or]: [
          { secret: input },
          { hash: hashed },
          {
            previousHash: hashed,
            previousHashExpiresAt: { [Op.gt]: new Date() },
          },
        ],
      },
    });
  }

  // associations

  @BelongsTo(() => User, "userId")
  user: User;

  @ForeignKey(() => User)
  @Column(DataType.UUID)
  userId: string;

  // methods

  /**
   * Rotates the secret of this API key in place, keeping its name, scopes and
   * expiry. The outgoing secret is optionally retained for a grace period so
   * that consumers can be updated before it stops working.
   *
   * @param ctx The API context.
   * @param gracePeriodHours The number of hours the outgoing secret remains
   * valid. Zero discards it immediately.
   * @returns the saved API key, with the new plain-text `value` available.
   */
  public rotate(ctx: APIContext, gracePeriodHours: number) {
    const previousHash = this.hash;
    const secret = ApiKey.createSecret();

    this.previousHash = gracePeriodHours > 0 ? previousHash : null;
    this.previousHashExpiresAt =
      gracePeriodHours > 0 ? addHours(new Date(), gracePeriodHours) : null;
    this.value = secret;
    this.hash = hash(secret);
    this.last4 = secret.slice(-4);

    return this.saveWithCtx(ctx, undefined, { name: "regenerate" });
  }

  updateActiveAt = async () => {
    const fiveMinutesAgo = subMinutes(new Date(), 5);

    // ensure this is updated only every few minutes otherwise
    // we'll be constantly writing to the DB as API requests happen
    if (!this.lastActiveAt || this.lastActiveAt < fiveMinutesAgo) {
      this.lastActiveAt = new Date();
    }

    return this.save({ silent: true });
  };

  /** Checks if the API key has access to the given path */
  canAccess = (path: string) => {
    if (!this.scope) {
      return true;
    }

    // MCP endpoint access is allowed if the key has any valid scope.
    // Fine-grained scope enforcement happens at the tool level.
    if (path.startsWith("/mcp")) {
      return this.scope.some((scope) =>
        AuthenticationHelper.isValidScope(scope)
      );
    }

    return AuthenticationHelper.canAccess(path, this.scope);
  };
}

export default ApiKey;
