import { Portal } from "solid-js/web"
import { Show } from "solid-js"
import { useTitlebarLeftMount } from "@opencode-ai/app"
import { Avatar } from "@opencode-ai/ui/v2/avatar-v2"
import { MenuV2 } from "@opencode-ai/ui/v2/menu-v2"
import { createAuthStore } from "./auth"
import { t } from "./i18n"

function SignOutIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 2v10" />
      <path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
    </svg>
  )
}

export function DesktopUserMenu() {
  const auth = createAuthStore()
  const leftMount = useTitlebarLeftMount()

  return (
    <Show when={leftMount()} keyed>
      {(mount) => (
        <Portal mount={mount}>
          <Show when={auth.state().status === "signedIn" && auth.state().user} keyed>
            {(user) => (
              <MenuV2 gutter={4} modal={false} placement="bottom-start">
                <MenuV2.Trigger as="button" type="button" class="outline-none">
                    <Avatar
                      size="x-large"
                      src={user.avatar_url}
                      fallback={user.fullname}
                    />
                  </MenuV2.Trigger>
                  <MenuV2.Portal>
                    <MenuV2.Content>
                      <div class="flex items-center gap-2 px-3 py-2">
                        <Avatar
                          size="2x-large"
                          src={user.avatar_url}
                          fallback={user.fullname}
                        />
                        <div class="flex flex-col min-w-0">
                          <span class="text-12-semibold text-text-base truncate leading-[1.5]">{user.fullname}</span>
                          <span class="text-11-regular text-text-weak truncate leading-none">{user.email}</span>
                        </div>
                      </div>
                      <MenuV2.Separator />
                      <MenuV2.Item onSelect={() => auth.signOut()}>
                        <span class="flex items-center gap-2 text-text-base">
                          <SignOutIcon />
                          {t("desktop.auth.userMenu.logout")}
                        </span>
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
