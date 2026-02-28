/**
 * Lit integration for EasyDB
 *
 * @example
 * import { EasyDBQueryController, EasyDBRecordController } from '@rckflr/easydb/lit';
 *
 * class AdminList extends LitElement {
 *   _admins = new EasyDBQueryController(this, db.users.where('role', 'admin'));
 *   render() {
 *     return html`${this._admins.data.map(u => html`<span>${u.name}</span>`)}`;
 *   }
 * }
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';

interface QueryLike<T = any> {
  toArray(): Promise<T[]>;
}

interface StoreLike<T = any> {
  all(): QueryLike<T>;
  get(key: any): Promise<T | undefined>;
  put(value: T): Promise<any>;
  watch(opts?: { key?: any }): AsyncIterable<any>;
}

interface QueryControllerOptions {
  watch?: boolean;
}

export declare class EasyDBQueryController<T = any> implements ReactiveController {
  data: T[];
  loading: boolean;
  error: Error | null;

  constructor(
    host: ReactiveControllerHost,
    queryOrStore: QueryLike<T> | StoreLike<T>,
    opts?: QueryControllerOptions,
  );

  hostConnected(): void;
  hostDisconnected(): void;
  refresh(): void;
}

export declare class EasyDBRecordController<T = any> implements ReactiveController {
  data: T | undefined;
  loading: boolean;
  error: Error | null;

  constructor(
    host: ReactiveControllerHost,
    store: StoreLike<T>,
    key: any,
    opts?: QueryControllerOptions,
  );

  hostConnected(): void;
  hostDisconnected(): void;
  refresh(): void;
}
