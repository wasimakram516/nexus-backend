import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '../../prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeGateway } from './realtime.gateway';

describe('RealtimeGateway', () => {
  let gateway: RealtimeGateway;

  const jwtServiceMock = { verifyAsync: jest.fn() };
  const configValues: Record<string, unknown> = {
    REALTIME_ENABLED: true,
    JWT_ACCESS_SECRET: 'test-secret',
  };
  const configServiceMock = {
    get: jest.fn((key: string) => configValues[key]),
    getOrThrow: jest.fn((key: string) => configValues[key]),
  };
  const prismaMock = {
    user: { findUnique: jest.fn() },
    refreshSession: { findFirst: jest.fn() },
  };

  const activeUser = {
    id: 'user-1',
    status: UserStatus.ACTIVE,
    deletedAt: null,
    role: 'ADMIN',
  };

  function makeClient(token?: string) {
    return {
      handshake: { auth: { token } },
      data: {},
      disconnect: jest.fn(),
      emit: jest.fn(),
      join: jest.fn(),
      leave: jest.fn(),
    } as unknown as import('socket.io').Socket & {
      disconnect: jest.Mock;
      emit: jest.Mock;
      join: jest.Mock;
      leave: jest.Mock;
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    configValues.REALTIME_ENABLED = true;
    prismaMock.user.findUnique.mockResolvedValue(activeUser);
    prismaMock.refreshSession.findFirst.mockResolvedValue({ id: 'session-1' });

    const moduleRef = await Test.createTestingModule({
      providers: [
        RealtimeGateway,
        { provide: JwtService, useValue: jwtServiceMock },
        { provide: ConfigService, useValue: configServiceMock },
        { provide: PrismaService, useValue: prismaMock },
      ],
    }).compile();

    gateway = moduleRef.get(RealtimeGateway);
  });

  describe('handleConnection', () => {
    it('disconnects immediately when REALTIME_ENABLED is not set, before verifying any token', async () => {
      configValues.REALTIME_ENABLED = false;
      const client = makeClient('some-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
      expect(jwtServiceMock.verifyAsync).not.toHaveBeenCalled();
    });

    it('disconnects when no token is supplied', async () => {
      const client = makeClient(undefined);

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects on an invalid/expired token', async () => {
      jwtServiceMock.verifyAsync.mockRejectedValue(new Error('bad token'));
      const client = makeClient('bad-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the authenticated user no longer exists', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      prismaMock.user.findUnique.mockResolvedValue(null);
      const client = makeClient('valid-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the account is deactivated', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...activeUser,
        status: UserStatus.SUSPENDED,
      });
      const client = makeClient('valid-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the account is soft-deleted', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...activeUser,
        deletedAt: new Date(),
      });
      const client = makeClient('valid-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('disconnects when the token carries a revoked/expired session', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({
        sub: 'user-1',
        sessionId: 'session-1',
      });
      prismaMock.refreshSession.findFirst.mockResolvedValue(null);
      const client = makeClient('valid-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).toHaveBeenCalled();
    });

    it('accepts a fully valid connection and stores the payload on client.data', async () => {
      const payload = { sub: 'user-1', sessionId: 'session-1' };
      jwtServiceMock.verifyAsync.mockResolvedValue(payload);
      const client = makeClient('valid-token');

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect((client.data as { user?: unknown }).user).toEqual(payload);
    });
  });

  describe('superadmin room', () => {
    it('auto-joins a SUPERADMIN to the reserved room', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      prismaMock.user.findUnique.mockResolvedValue({
        ...activeUser,
        role: 'SUPERADMIN',
      });
      const client = makeClient('valid-token');
      await gateway.handleConnection(client);
      expect(client.join).toHaveBeenCalledWith('platform:superadmin');
    });

    it('does not join a non-superadmin', async () => {
      jwtServiceMock.verifyAsync.mockResolvedValue({ sub: 'user-1' });
      const client = makeClient('valid-token');
      await gateway.handleConnection(client);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects a client room:join for any platform: room', () => {
      const client = makeClient();
      gateway.joinRoom(client, { room: 'platform:superadmin' });
      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'room:error',
        expect.any(Object),
      );
    });

    it('emitDomainEvent targets the room', () => {
      const emit = jest.fn();
      gateway.server = { to: jest.fn().mockReturnValue({ emit }) } as never;
      gateway.emitDomainEvent('r', 'e', { a: 1 });
      expect(emit).toHaveBeenCalledWith('e', { a: 1 });
    });
  });

  describe('joinRoom / leaveRoom', () => {
    it('rejects a missing room', () => {
      const client = makeClient();
      gateway.joinRoom(client, {});
      expect(client.join).not.toHaveBeenCalled();
      expect(client.emit).toHaveBeenCalledWith(
        'room:error',
        expect.any(Object),
      );
    });

    it('rejects a non-string room', () => {
      const client = makeClient();
      gateway.joinRoom(client, { room: 12345 });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('rejects an oversized room name', () => {
      const client = makeClient();
      gateway.joinRoom(client, { room: 'x'.repeat(500) });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('joins a well-formed room', () => {
      const client = makeClient();
      gateway.joinRoom(client, { room: 'institution:abc-123' });
      expect(client.join).toHaveBeenCalledWith('institution:abc-123');
      expect(client.emit).toHaveBeenCalledWith('room:joined', {
        room: 'institution:abc-123',
      });
    });

    it('rejects a malformed room on leave', () => {
      const client = makeClient();
      gateway.leaveRoom(client, {});
      expect(client.leave).not.toHaveBeenCalled();
    });

    it('leaves a well-formed room', () => {
      const client = makeClient();
      gateway.leaveRoom(client, { room: 'institution:abc-123' });
      expect(client.leave).toHaveBeenCalledWith('institution:abc-123');
    });
  });
});
