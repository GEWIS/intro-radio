/**
 * Fires a native browser notification for a chat message, but only when the
 * tab is unfocused -- the user is already looking at the chat otherwise.
 * Permission is requested automatically the first time this is used.
 */
export function useChatNotifications() {
  if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
    void Notification.requestPermission();
  }

  function notify(title: string, body: string) {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'granted') return;
    if (document.hasFocus()) return;

    const notification = new Notification(title, { body });
    notification.addEventListener('click', () => {
      window.focus();
      notification.close();
    });
  }

  return { notify };
}
