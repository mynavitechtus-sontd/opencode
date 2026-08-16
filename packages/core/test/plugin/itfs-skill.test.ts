import { describe, expect } from "bun:test"
import { Effect } from "effect"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { ItfsSkillPlugin } from "@opencode-ai/core/plugin/itfs-skill"
import { SkillV2 } from "@opencode-ai/core/skill"
import { testEffect } from "../lib/effect"
import { host } from "./host"

const it = testEffect(AppNodeBuilder.build(SkillV2.node))

describe("ItfsSkillPlugin.Plugin", () => {
  it.effect("registers itfs-interview", () =>
    Effect.gen(function* () {
      const skill = yield* SkillV2.Service
      yield* ItfsSkillPlugin.Plugin.effect(host({ skill: { ...skill, reload: skill.reload } }))

      const interview = (yield* skill.list()).find((s) => s.name === "itfs-interview")
      expect(interview).toBeDefined()
      expect(interview?.description).toContain("evaluate, verify, or assess ITFS levels")
      expect(interview?.content).toContain("# ITFS Interview")
      expect(interview?.content).toContain("There are nine levels:")
      expect(interview?.content).not.toMatch(/^---/)
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
      expect(onboarding?.content).not.toMatch(/^---/)
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
})
