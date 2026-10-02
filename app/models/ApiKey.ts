import { isPast } from "date-fns";
import { computed, observable } from "mobx";
import Model from "./base/Model";
import Field from "./decorators/Field";
import User from "./User";
import Relation from "./decorators/Relation";
import type { Searchable } from "./interfaces/Searchable";

class ApiKey extends Model implements Searchable {
  static modelName = "ApiKey";

  constructor(fields: Record<string, unknown>, store: Model["store"]) {
    super(fields, store);
    this.initialize(fields);
  }

  /** The human-readable name of this API key */
  @Field
  @observable
  name: string;

  /** A list of scopes that this API key has access to. Null or undefined means full access; an empty list means no access. */
  @Field
  @observable
  scope?: string[] = undefined;
  /** An optional datetime that the API key expires. */
  @Field
  @observable
  expiresAt?: string = undefined;
  /** Timestamp that the API key was last used. */
  @observable
  lastActiveAt?: string = undefined;
  /** Timestamp that the replaced secret stops authenticating, if a grace period is active. */
  @observable
  previousHashExpiresAt?: string = undefined;
  /** The user who this API key belongs to. */
  @Relation(() => User)
  user: User;

  /** The user ID that the API key belongs to. */
  userId: string;

  /** The plain text value of the API key, only available on creation. */
  value: string;

  /** A preview of the last 4 characters of the API key. */
  last4: string;

  /** Whether the API key has an expiry in the past. */
  @computed
  get isExpired() {
    return this.expiresAt ? isPast(new Date(this.expiresAt)) : false;
  }

  /** Whether the API key has full access: no scope set, or the wildcard scope. */
  @computed
  get isFullAccess() {
    return !this.scope || this.scope.includes("*");
  }

  /** Whether a previously replaced secret is still within its grace period. */
  @computed
  get hasActiveGracePeriod() {
    return this.previousHashExpiresAt
      ? !isPast(new Date(this.previousHashExpiresAt))
      : false;
  }

  @computed
  get obfuscatedValue() {
    if (this.createdAt < new Date("2022-12-03").toISOString()) {
      return `...${this.last4}`;
    }
    return `ol...${this.last4}`;
  }

  @computed
  get searchContent(): string[] {
    return [this.name, this.obfuscatedValue].filter(Boolean);
  }

  @computed
  get searchSuppressed(): boolean {
    return false;
  }
}

export default ApiKey;
