import { useEffect } from 'react'
import { useDiscordChatStore } from '@renderer/state/discordChatStore'
import { useFriendsStore } from '@renderer/state/friendsStore'

export function DiscordChatController(): null {
  const discordState = useFriendsStore((state) => state.snapshot.providers.discord.state)
  const initFriends = useFriendsStore((state) => state.init)
  const startChat = useDiscordChatStore((state) => state.start)
  const refreshInbox = useDiscordChatStore((state) => state.refreshInbox)
  const resetChat = useDiscordChatStore((state) => state.reset)

  useEffect(() => {
    startChat()
    void initFriends()
  }, [initFriends, startChat])

  useEffect(() => {
    if (discordState === 'ready') void refreshInbox()
    else if (discordState === 'not-connected') resetChat()
  }, [discordState, refreshInbox, resetChat])

  return null
}
