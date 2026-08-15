/// <reference path="../markdown.d.ts" />

export * as ItfsSkillPlugin from "./itfs-skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import itfsInterviewContent from "./skill/itfs-interview.md" with { type: "text" }
import itfsOnboardingContent from "./skill/itfs-onboarding.md" with { type: "text" }

const stripFrontmatter = (content: string) => {
  if (!content.startsWith("---")) return content
  const end = content.indexOf("\n---", 4)
  if (end === -1) return content
  return content.slice(end + 4).replace(/^\n+/, "")
}

export const Plugin = define({
  id: "itfs-skill",
  effect: Effect.fn(function* (ctx) {
    yield* ctx.skill.transform((draft) => {
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "itfs-interview",
            description:
              "Sử dụng khi user muốn đánh giá, phỏng vấn, evaluate, assess or self-assessment ITFS level.",
            location: AbsolutePath.make("/builtin/itfs-interview.md"),
            content: stripFrontmatter(itfsInterviewContent),
          }),
        }),
      )
      draft.source(
        SkillV2.EmbeddedSource.make({
          type: "embedded",
          skill: SkillV2.Info.make({
            name: "itfs-onboarding",
            description:
              "Use when a user is new to ITFS, asks for onboarding or profile setup, or their ITFS profile is missing primary role, focus role, or prior level.",
            location: AbsolutePath.make("/builtin/itfs-onboarding.md"),
            content: stripFrontmatter(itfsOnboardingContent),
          }),
        }),
      )
    })
  }),
})
