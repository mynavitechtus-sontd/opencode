import { createSignal, onCleanup } from "solid-js"
import type { AuthState } from "../preload/types"

export function createAuthStore() {
  const [state, setState] = createSignal<AuthState>({ status: "signedOut" })

  window.api.auth.getState().then(setState)
  const unsub = window.api.auth.subscribe(setState)
  onCleanup(unsub)

  return {
    state,
    signIn: () => window.api.auth.signIn(),
    signOut: () => window.api.auth.signOut(),
  }
}
