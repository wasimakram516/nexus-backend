import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';
import { CurrentUser } from '../interfaces/current-user.interface';

type RequestContextState = {
  requestId?: string;
  currentUser?: CurrentUser | null;
  allowHardDelete?: boolean;
  skipAudit?: boolean;
  deleteReason?: string | null;
};

@Injectable()
export class RequestContextService {
  private readonly storage = new AsyncLocalStorage<RequestContextState>();

  run<T>(state: RequestContextState, callback: () => T): T {
    return this.storage.run(state, callback);
  }

  get<K extends keyof RequestContextState>(key: K): RequestContextState[K] {
    return this.storage.getStore()?.[key];
  }

  set<K extends keyof RequestContextState>(
    key: K,
    value: RequestContextState[K],
  ) {
    const store = this.storage.getStore();
    if (!store) {
      return;
    }

    store[key] = value;
  }

  async runWith<T>(
    state: Partial<RequestContextState>,
    callback: () => Promise<T>,
  ): Promise<T> {
    const currentState = this.storage.getStore() ?? {};
    return this.storage.run(
      {
        ...currentState,
        ...state,
      },
      callback,
    );
  }
}
