import { openForConversation, ownDmKeyPair } from "@/common";
import { notificationBody } from "@/lib/desktopNotification";

/** What a notification carries, whether or not the message was sealed. */
interface NotifiableMessage {
  text?: string | null;
  sealed?: string | null;
  attachments?: string[] | null;
  conversation_id?: string;
}

/**
 * The notification body for a message that may be sealed. Opened here because
 * the row's own decrypt is a different effect, and may not run at all.
 */
export async function sealedNotificationBody(
  msg: NotifiableMessage,
  where: { host: string; memberId?: string },
): Promise<string> {
  // The message's own conversation, not the one on screen: a DM notifies while
  // you are reading a channel, and the wrong id derives the wrong key.
  if (!msg.sealed || !msg.conversation_id || !where.host || !where.memberId) {
    return notificationBody(msg);
  }

  try {
    const opened = await openForConversation({
      sealed: msg.sealed,
      conversationId: msg.conversation_id,
      memberId: where.memberId,
      recipientKeys: await ownDmKeyPair(where.host),
    });
    if (opened) return notificationBody({ ...msg, text: opened.text, sealed: null });
  } catch {
    // No key for us, or one that will not open. Either way the envelope wording
    // stands; a notification is not the place to say which.
  }

  return notificationBody(msg);
}
