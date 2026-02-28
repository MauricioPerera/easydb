/**
 * EasyDB — Framework Integration Examples
 *
 * Shows how to use EasyDB with each supported framework.
 * Each example is self-contained.
 */

// ════════════════════════════════════════════════════════
// 1. React (useQuery, useRecord)
// ════════════════════════════════════════════════════════

// import { useQuery, useRecord } from '@rckflr/easydb/react';
//
// function UserList({ db }) {
//   const { data, loading, error } = useQuery(db.users);
//
//   if (loading) return <p>Loading...</p>;
//   if (error) return <p>Error: {error.message}</p>;
//   return (
//     <ul>
//       {data.map(user => <li key={user.id}>{user.name}</li>)}
//     </ul>
//   );
// }
//
// // With a filtered query:
// function AdminList({ db }) {
//   const { data } = useQuery(db.users.where('role', 'admin'));
//   return data.map(u => <span key={u.id}>{u.name}</span>);
// }
//
// // Single record:
// function UserProfile({ db, userId }) {
//   const { data: user, loading } = useRecord(db.users, userId);
//   if (loading) return <p>Loading...</p>;
//   return <h1>{user?.name}</h1>;
// }

// ════════════════════════════════════════════════════════
// 2. Vue 3 (useQuery, useRecord — composables)
// ════════════════════════════════════════════════════════

// import { useQuery, useRecord } from '@rckflr/easydb/vue';
//
// // In <script setup>:
// // const { data, loading, error } = useQuery(db.users);
// // const admins = useQuery(db.users.where('role', 'admin'));
//
// // Reactive key (re-fetches when userId ref changes):
// // const userId = ref(1);
// // const { data: user } = useRecord(db.users, userId);

// ════════════════════════════════════════════════════════
// 3. Svelte (queryStore, recordStore)
// ════════════════════════════════════════════════════════

// import { queryStore, recordStore } from '@rckflr/easydb/svelte';
//
// // In a Svelte component:
// // const users = queryStore(db.users);
// // const admins = queryStore(db.users.where('role', 'admin'));
// // const user = recordStore(db.users, 1);
//
// // In template:
// // {#if $users.loading}
// //   <p>Loading...</p>
// // {:else}
// //   {#each $users.data as user}
// //     <p>{user.name}</p>
// //   {/each}
// // {/if}

// ════════════════════════════════════════════════════════
// 4. Angular 16+ (createQuery, createRecord — signals)
// ════════════════════════════════════════════════════════

// import { createQuery, createRecord } from '@rckflr/easydb/angular';
//
// @Component({
//   template: `
//     @if (users.loading()) {
//       <p>Loading...</p>
//     } @else {
//       @for (user of users.data(); track user.id) {
//         <p>{{ user.name }}</p>
//       }
//     }
//   `
// })
// class UserListComponent {
//   private db = inject(DB_TOKEN);
//
//   // All users, auto-refreshes on mutations
//   users = createQuery(this.db.users);
//
//   // Filtered query via function (reactive)
//   admins = createQuery(() => this.db.users.where('role', 'admin'));
//
//   // Single record with reactive key
//   userId = signal(1);
//   user = createRecord(this.db.users, () => this.userId());
// }

// ════════════════════════════════════════════════════════
// 5. Solid.js (createQuery, createRecord — signals)
// ════════════════════════════════════════════════════════

// import { createQuery, createRecord } from '@rckflr/easydb/solid';
//
// function UserList() {
//   const users = createQuery(db.users);
//
//   return (
//     <Show when={!users.loading()} fallback={<p>Loading...</p>}>
//       <For each={users.data()}>
//         {user => <p>{user.name}</p>}
//       </For>
//     </Show>
//   );
// }
//
// // Reactive query (re-runs when signal changes):
// function FilteredList() {
//   const [role, setRole] = createSignal('admin');
//   const users = createQuery(() => db.users.where('role', role()));
//
//   return (
//     <>
//       <button onClick={() => setRole('member')}>Show Members</button>
//       <For each={users.data()}>{u => <p>{u.name}</p>}</For>
//     </>
//   );
// }

// ════════════════════════════════════════════════════════
// 6. Preact (useQuery, useRecord — hooks)
// ════════════════════════════════════════════════════════

// import { useQuery, useRecord } from '@rckflr/easydb/preact';
//
// // Same API as React! Drop-in replacement:
// function UserList({ db }) {
//   const { data, loading, error } = useQuery(db.users);
//   if (loading) return <p>Loading...</p>;
//   return data.map(u => <p key={u.id}>{u.name}</p>);
// }
//
// function UserProfile({ db, userId }) {
//   const { data: user } = useRecord(db.users, userId);
//   return <h1>{user?.name}</h1>;
// }

// ════════════════════════════════════════════════════════
// 7. Lit (ReactiveControllers)
// ════════════════════════════════════════════════════════

// import { EasyDBQueryController, EasyDBRecordController } from '@rckflr/easydb/lit';
// import { LitElement, html } from 'lit';
//
// class UserList extends LitElement {
//   _users = new EasyDBQueryController(this, db.users);
//
//   render() {
//     const { data, loading, error } = this._users;
//     if (loading) return html`<p>Loading...</p>`;
//     if (error) return html`<p>Error: ${error.message}</p>`;
//     return html`
//       <ul>
//         ${data.map(user => html`<li>${user.name}</li>`)}
//       </ul>
//     `;
//   }
// }
//
// class UserProfile extends LitElement {
//   _user = new EasyDBRecordController(this, db.users, 1);
//
//   render() {
//     const { data, loading } = this._user;
//     if (loading) return html`<p>Loading...</p>`;
//     return html`<h1>${data?.name}</h1>`;
//   }
// }
// customElements.define('user-list', UserList);
// customElements.define('user-profile', UserProfile);
