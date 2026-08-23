import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDefaultTagsForUrl } from "../default-tags";

describe("getDefaultTagsForUrl", () => {
  it("adds the github tag for github.com links", () => {
    assert.deepEqual(getDefaultTagsForUrl(new URL("https://github.com/iamrajjoshi/clip")), [
      "github",
    ]);
  });

  it("treats www.github.com as github", () => {
    assert.deepEqual(getDefaultTagsForUrl(new URL("https://www.github.com/iamrajjoshi/clip")), [
      "github",
    ]);
  });

  it("does not tag non-standard github hosts", () => {
    assert.deepEqual(getDefaultTagsForUrl(new URL("https://gist.github.com/iamrajjoshi/clip")), []);
  });
});
