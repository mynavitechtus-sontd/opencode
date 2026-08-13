import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { composeItfsInterview, ItfsSkillPlugin } from "@opencode-ai/core/plugin/itfs-skill"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("ItfsSkillPlugin.Plugin", () => {
  it.effect("registers itfs-interview with inlined level definitions", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const interview = (yield* skill.list()).find((s) => s.name === "itfs-interview")
      expect(interview).toBeDefined()
      expect(interview?.description).toContain("evaluate, verify, or assess ITFS levels")
      expect(interview?.content).toContain("# ITFS Level Definition")
      expect(interview?.content).not.toContain("{{ITFS_LEVELS_DEFINITION}}")
    }),
  )

  it.effect("registers itfs-onboarding", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const onboarding = (yield* skill.list()).find((s) => s.name === "itfs-onboarding")
      expect(onboarding).toBeDefined()
      expect(onboarding?.description).toContain("profile is missing primary role")
      expect(onboarding?.content).toContain("# ITFS Onboarding")
    }),
  )

  it.effect("keeps skill names unique when repeated", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const list = yield* skill.list()
      const names = list.map((s) => s.name)
      expect(new Set(names).size).toBe(names.length)
      expect(list.filter((s) => s.name === "itfs-interview")).toHaveLength(1)
    }),
  )

  it.effect("does not interpret $-substitution sequences in inlined level definitions", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const interview = (yield* skill.list()).find((s) => s.name === "itfs-interview")
      expect(interview).toBeDefined()
      expect(interview?.content).toContain("$\\leftrightarrow$")
      expect(interview?.content).toContain("# ITFS Level Definition")
    }),
  )

  it.effect("composeItfsInterview preserves dollar substitution sequences literally", () =>
    Effect.gen(function* () {
      const body = "prefix {{ITFS_LEVELS_DEFINITION}} suffix"
      const levels = "$& $' $$ $` $1 literal"
      expect(composeItfsInterview(body, levels)).toBe("prefix $& $' $$ $` $1 literal suffix")
    }),
  )
})
