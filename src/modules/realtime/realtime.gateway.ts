import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/** Reasonable upper bound on a room name — this isn't validating against a
 *  real naming convention (none exists yet, no domain events are wired),
 *  just rejecting obviously-malformed payloads per P0-10 requirement #2. */
const MAX_ROOM_NAME_LENGTH = 200;

@WebSocketGateway({
  cors: {
    origin: '*',
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    // Realtime is parked for v1 (decision #11) — disabled by default
    // (REALTIME_ENABLED unset/false) because no domain-event consumer
    // exists yet, so there is nothing legitimate to authorize room access
    // against (P0-10). Reject before even attempting JWT verification.
    if (!this.configService.get<boolean>('REALTIME_ENABLED')) {
      client.disconnect();
      return;
    }

    const token = client.handshake.auth.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }

    try {
      const payload = await this.jwtService.verifyAsync<
        Record<string, unknown> & { sub?: string; sessionId?: string }
      >(token, {
        secret: this.configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });

      // Same liveness check JwtStrategy applies to every REST request
      // (§ P0-10 requirement #2: "expired/revoked sessions") — JWT
      // signature/expiry alone doesn't reflect a deactivated account or a
      // revoked refresh session, only that the token was validly signed.
      if (typeof payload.sub !== 'string') {
        client.disconnect();
        return;
      }
      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, status: true, deletedAt: true },
      });
      if (!user || user.deletedAt || user.status !== UserStatus.ACTIVE) {
        client.disconnect();
        return;
      }
      if (payload.sessionId) {
        const session = await this.prisma.refreshSession.findFirst({
          where: {
            id: payload.sessionId,
            userId: user.id,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true },
        });
        if (!session) {
          client.disconnect();
          return;
        }
      }

      (client.data as { user?: Record<string, unknown> }).user = payload;
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('room:join')
  joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { room?: unknown },
  ) {
    // Malformed-payload rejection (P0-10 requirement #2). This is
    // deliberately NOT authorizing the room against institution/campus/
    // feature access — no room-naming convention exists yet since no real
    // domain event is wired (out of scope per the task; see the gateway's
    // own class comment). That authorization is real feature work for
    // whenever this gets un-parked, not invented speculatively here.
    if (
      typeof payload.room !== 'string' ||
      payload.room.length === 0 ||
      payload.room.length > MAX_ROOM_NAME_LENGTH
    ) {
      client.emit('room:error', { message: 'Invalid room.' });
      return;
    }
    void client.join(payload.room);
    client.emit('room:joined', { room: payload.room });
  }

  @SubscribeMessage('room:leave')
  leaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: { room?: unknown },
  ) {
    if (typeof payload.room !== 'string' || payload.room.length === 0) {
      client.emit('room:error', { message: 'Invalid room.' });
      return;
    }
    void client.leave(payload.room);
    client.emit('room:left', { room: payload.room });
  }

  emitDomainEvent(room: string, event: string, payload: unknown) {
    this.server.to(room).emit(event, payload);
  }
}
