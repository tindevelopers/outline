import * as React from "react";
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
 * Reminder sent to an outside collaborator who has not yet accepted access to
 * a shared collection or document. It names the shared item, and never implies
 * access to the workspace as a whole.
 */
export default class GuestInviteReminderEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Invitation;
  }

  protected subject({ actorName, itemName }: Props) {
    return this.t(
      "Reminder: {{ actorName }} shared “{{ itemName }}” with you",
      {
        actorName,
        itemName,
      }
    );
  }

  protected preview({ isCollection }: Props) {
    return this.t("The {{ itemType }} shared with you is still waiting.", {
      itemType: isCollection ? "collection" : "document",
    });
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
      : `${teamUrl}?ref=guest-invite-reminder-email`;

    return `
${this.t("Reminder: {{ actorName }} shared “{{ itemName }}” with you", {
  actorName,
  itemName,
})}

${this.t(
  "This {{ itemType }} in the {{ teamName }} workspace is still waiting for you.",
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
      : `${teamUrl}?ref=guest-invite-reminder-email`;

    return (
      <EmailTemplate previewText={this.preview(props)}>
        <Header />

        <Body>
          <Heading>
            {this.t(
              "Reminder: {{ actorName }} shared “{{ itemName }}” with you",
              {
                actorName,
                itemName,
              }
            )}
          </Heading>
          <p>
            {this.t(
              "This {{ itemType }} in the {{ teamName }} workspace is still waiting for you.",
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
