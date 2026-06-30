import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "notion-to-html",
});

export const events = {
  generatePage: "page/generate",
  pageDirty: "page/dirty",
} as const;
