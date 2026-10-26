export type ChatListViewContext = {
  chatlist: HTMLElement;
  order: string[];
  contacts: Record<string, { dev: boolean; data: { unlocked: boolean } }>;
  devMode: boolean;
  renderRow: (id: string) => void;
  issuesLength: number;
};

export function renderChatList(ctx: ChatListViewContext): void {
  const { chatlist, order, contacts, devMode, renderRow, issuesLength } = ctx;
  chatlist.innerHTML = "";
  let shown = 0;
  for (const id of order) {
    const c = contacts[id];
    if (!c) continue;
    if (c.dev && !devMode) continue;
    if (!c.data.unlocked) continue;
    renderRow(id);
    shown++;
  }
  if (shown === 0 && issuesLength === 0) {
    chatlist.innerHTML = `<p class="rounded-2xl bg-chat-800 p-6 text-center text-sm text-ink-300">No chats yet — add a character file in src/story/characters/ 💬</p>`;
  }
}