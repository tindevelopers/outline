import * as React from "react";
import env from "@server/env";
import type { EmailProps } from "./BaseEmail";
import BaseEmail, { EmailMessageCategory } from "./BaseEmail";
import Body from "./components/Body";
import Button from "./components/Button";
import EmailTemplate from "./components/EmailLayout";
import EmptySpace from "./components/EmptySpace";
import Footer from "./components/Footer";
import Header from "./components/Header";
import Heading from "./components/Heading";

type Props = EmailProps & {
  name: string;
  actorName: string;
  teamName: string;
  teamUrl: string;
  /** The name of the collection or document that was shared. */
  itemName: string;
  /** Whether the shared item is a collection rather than a document. */
  isCollection: boolean;
  /** One-click sign-in token. */
  token?: string;
};

/**
 * Email sent to an outside collaborator when a collection or document is shared
 * with them. Unlike the workspace invite, it names the shared item and never
 * implies access to the workspace as a whole.
 */
export default class GuestInviteEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Invitation;
  }

  protected subject({ actorName, itemName }: Props) {
    return this.t("{{ actorName }} shared “{{ itemName }}” with you", {
      actorName,
      itemName,
    });
  }

  protected preview({ isCollection }: Props) {
    return this.t(
      "You have been given access to a shared {{ itemType }} in {{ appName }}.",
      {
        itemType: isCollection ? "collection" : "document",
        appName: env.APP_NAME,
      }
    );
  }

  protected renderAsText({
    teamName,
    actorName,
    teamUrl,
    itemName,
    isCollection,
    token,
  }: Props): string {
    const link = token
      ? `${teamUrl}/auth/email.callback?token=${token}`
      : `${teamUrl}?ref=guest-invite-email`;

    return `
${this.t("{{ actorName }} shared “{{ itemName }}” with you", {
  actorName,
  itemName,
})}

${this.t(
  "You have been given access to this {{ itemType }} in the {{ teamName }} workspace.",
  { itemType: isCollection ? "collection" : "document", teamName }
)}

${this.t("Open now")}: ${link}
`;
  }

  protected render(props: Props) {
    const { teamName, actorName, teamUrl, itemName, isCollection, token } =
      props;

    const link = token
      ? `${teamUrl}/auth/email.callback?token=${token}`
      : `${teamUrl}?ref=guest-invite-email`;

    return (
      <EmailTemplate previewText={this.preview(props)}>
        <Header />

        <Body>
          <Heading>
            {this.t("{{ actorName }} shared “{{ itemName }}” with you", {
              actorName,
              itemName,
            })}
          </Heading>
          <p>
            {this.t(
              "You have been given access to this {{ itemType }} in the {{ teamName }} workspace.",
              {
                itemType: isCollection ? "collection" : "document",
                teamName,
              }
            )}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={link}>{this.t("Open now")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
