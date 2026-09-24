import { Table, TBody, TR, TD } from "oy-vey";
import * as React from "react";
import theme from "@shared/styles/theme";
import env from "@server/env";

type Props = {
  unsubscribeUrl?: string;
  unsubscribeText?: string;
  children?: React.ReactNode;
};

export const Link = ({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) => {
  const linkStyle = {
    color: theme.slate,
    fontWeight: 500,
    textDecoration: "none",
    marginRight: "10px",
  };

  return (
    <a href={href} style={linkStyle}>
      {children}
    </a>
  );
};

export default ({ unsubscribeUrl, unsubscribeText, children }: Props) => {
  const footerStyle = {
    padding: "20px 0",
    borderTop: `1px solid ${theme.smokeDark}`,
    color: theme.slate,
    fontSize: "14px",
  };
  const footerLinkStyle = {
    padding: "0",
    color: theme.slate,
    fontSize: "14px",
  };

  return (
    <Table width="100%">
      <TBody>
        <TR>
          <TD style={footerStyle}>
            <Link href={env.URL}>{env.APP_NAME}</Link>
          </TD>
        </TR>
        {unsubscribeUrl && (
          <TR>
            <TD style={footerLinkStyle}>
              <Link href={unsubscribeUrl}>
                {unsubscribeText ?? "Unsubscribe from these emails"}
              </Link>
            </TD>
          </TR>
        )}
        {children && (
          <TR>
            <TD style={footerLinkStyle}>{children}</TD>
          </TR>
        )}
      </TBody>
    </Table>
  );
};
