import { Portal } from "solid-js/web"
import { Show } from "solid-js"
import { useLanguage } from "@opencode-ai/app"
import { useTitlebarRightMount } from "@opencode-ai/app"
import { Avatar } from "@opencode-ai/ui/v2/avatar-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createAuthStore } from "./auth"

export function DesktopUserMenu() {
  const language = useLanguage()
  const auth = createAuthStore()
  const rightMount = useTitlebarRightMount()

  return (
    <Show when={rightMount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={auth.state().status === "signedIn" && auth.state().user} keyed>
            {(user) => (
              <MenuV2 gutter={4} modal={false} placement="bottom-end">
                <MenuV2.Trigger as="button" type="button" class="outline-none">
                  <Avatar
                    size="small"
                    src={user.avatar_url}
                    fallback={user.fullname}
                  />
                </MenuV2.Trigger>
                <MenuV2.Portal>
                  <MenuV2.Content>
                    <div class="flex items-center gap-2 px-3 py-2">
                      <Avatar
                        size="small"
                        src={user.avatar_url}
                        fallback={user.fullname}
                      />
                      <div class="flex flex-col min-w-0">
                        <span class="text-12-semibold text-text-base truncate">{user.fullname}</span>
                        <span class="text-11-regular text-text-weak truncate">{user.email}</span>
                      </div>
                    </div>
                    <MenuV2.Separator />
                    <MenuV2.Item onSelect={() => auth.signOut()}>
                      {language.t("desktop.auth.userMenu.logout")}
                    </MenuV2.Item>
                  </MenuV2.Content>
                </MenuV2.Portal>
              </MenuV2>
            )}
          </Show>
        </Portal>
      )}
    </Show>
  )
}
