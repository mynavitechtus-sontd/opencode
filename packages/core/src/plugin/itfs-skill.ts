/// <reference path="../markdown.d.ts" />

export * as ItfsSkillPlugin from "./itfs-skill"

import { define } from "./internal"
import { Effect } from "effect"
import { AbsolutePath } from "../schema"
import { SkillV2 } from "../skill"
import itfsInterviewContent from "./skill/itfs-interview.md" with { type: "text" }
import itfsOnboardingContent from "./skill/itfs-onboarding.md" with { type: "text" }
import itfsLevelsDefinitionContent from "./skill/itfs-levels-definition.md" with { type: "text" }

const ITFS_LEVELS_MARKER = "{{ITFS_LEVELS_DEFINITION}}"

export const composeItfsInterview = (body: string, levels: string) =>
  body.replace(ITFS_LEVELS_MARKER, () => levels)

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
              "Use when the user wants to evaluate, verify, or assess ITFS levels, or explicitly asks to start or continue an ITFS interview session.",
            location: AbsolutePath.make("/builtin/itfs-interview.md"),
            content: composeItfsInterview(itfsInterviewContent, itfsLevelsDefinitionContent),
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
            content: itfsOnboardingContent,
          }),
        }),
      )
    })
  }),
})
