import { auth } from '@/lib/auth';
import { channelFor, pusherServer } from '@/lib/events';
import { assertBoardAccess } from '@/lib/permissions';

// The board id is a uuid, and the name must be exactly the channel this app
// publishes to — not a prefix match, and not a presence channel.
const BOARD_CHANNEL =
  /^private-board-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

// Pusher socket ids are two decimal runs joined by a dot. Pusher signs
// `socket_id:channel_name`, so this field is not free-form text.
const SOCKET_ID = /^\d+\.\d+$/;

const forbidden = () => new Response('Forbidden', { status: 403 });

export async function POST(request: Request) {
  // Pusher always posts a form body, but this is a public endpoint: a
  // non-form body (JSON, no body at all) throws here rather than parsing to
  // an empty form, which would otherwise turn a malformed request into a 500
  // instead of the 400 below.
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  const socketId = form.get('socket_id');
  const channelName = form.get('channel_name');

  if (typeof socketId !== 'string' || typeof channelName !== 'string') {
    return new Response('Bad request', { status: 400 });
  }

  const session = await auth();
  if (!session?.user?.id) return forbidden();

  if (!SOCKET_ID.test(socketId)) return forbidden();

  const match = BOARD_CHANNEL.exec(channelName);
  if (!match) return forbidden();

  const boardId = match[1];
  if (channelName !== channelFor(boardId)) return forbidden();

  try {
    await assertBoardAccess(session.user.id, boardId, 'viewer');
  } catch {
    return forbidden();
  }

  const client = pusherServer();
  if (!client) return forbidden();

  return Response.json(client.authorizeChannel(socketId, channelName));
}
