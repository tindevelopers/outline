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
  userId: string;
  /** Name of the person who never accepted. */
  inviteeName: string;
  teamName: string;
  teamUrl: string;
};

/**
 * Email sent to the person who sent an invitation once it has expired without
 * being accepted, so they know to resend it if they still want the person to
 * have access.
 */
export default class InviteExpiredEmail extends BaseEmail<Props, void> {
  protected get category() {
    return EmailMessageCategory.Notification;
  }

  protected subject({ inviteeName }: Props) {
    return this.t("{{ inviteeName }}’s invite expired", { inviteeName });
  }

  protected preview() {
    return this.t(
      "You can resend the invitation from the member list if they still need access."
    );
  }

  protected renderAsText({ inviteeName, teamName, teamUrl }: Props): string {
    const membersLink = `${teamUrl}/settings/members`;

    return `
${this.t("{{ inviteeName }}’s invite expired", { inviteeName })}

${this.t(
  "The invitation you sent to {{ inviteeName }} for the {{ teamName }} workspace was not accepted in time, so the link no longer works.",
  { inviteeName, teamName }
)}

${this.t("You can resend the invitation from the member list if they still need access")}: ${membersLink}
`;
  }

  protected render({ inviteeName, teamName, teamUrl }: Props) {
    const membersLink = `${teamUrl}/settings/members`;

    return (
      <EmailTemplate previewText={this.preview()}>
        <Header />

        <Body>
          <Heading>
            {this.t("{{ inviteeName }}’s invite expired", { inviteeName })}
          </Heading>
          <p>
            {this.t(
              "The invitation you sent to {{ inviteeName }} for the {{ teamName }} workspace was not accepted in time, so the link no longer works.",
              { inviteeName, teamName }
            )}
          </p>
          <p>
            {this.t(
              "You can resend the invitation from the member list if they still need access."
            )}
          </p>
          <EmptySpace height={10} />
          <p>
            <Button href={membersLink}>{this.t("Go to members")}</Button>
          </p>
        </Body>

        <Footer />
      </EmailTemplate>
    );
  }
}
