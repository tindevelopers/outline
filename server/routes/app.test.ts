import { replaceTemplateTokens } from "@server/routes/app";

describe("replaceTemplateTokens", () => {
  it("should insert dollar sequences in a value literally", () => {
    // A shell snippet ending in a single-quoted `$` anchor is common in
    // technical documents. As a string replacement, `$'` splices the portion of
    // the template that follows the match into the page, closing the
    // screenreader-only wrapper early and leaving its content as direct
    // children of the flex body — which collapses the app to a narrow column.
    const content = "grep -oE 'Files.*\\(([0-9]+)\\)$' /tmp/auth.log";
    expect(replaceTemplateTokens("<div>{content}</div>", { content })).toBe(
      `<div>${content}</div>`
    );
  });

  it("should not interpret the other dollar replacement patterns", () => {
    const content = "$`$&$$";
    expect(replaceTemplateTokens("<div>{content}</div>", { content })).toBe(
      `<div>${content}</div>`
    );
  });

  it("should not treat a substituted value as a template", () => {
    expect(
      replaceTemplateTokens("{content} - {title}", {
        content: "the literal {title} token",
        title: "Title",
      })
    ).toBe("the literal {title} token - Title");
  });

  it("should leave unknown tokens untouched", () => {
    expect(replaceTemplateTokens("{unknown} {title}", { title: "T" })).toBe(
      "{unknown} T"
    );
  });
});
