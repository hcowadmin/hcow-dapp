# HCOW dApp — Frontend

**Status: complete and building.** `npm run build` produces a clean production bundle
with TypeScript strict mode, `noUnusedLocals`, `noUnusedParameters` and
`noImplicitReturns` all enabled.

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle to dist/
npm run lint     # tsc --noEmit
```

Node 18 or newer.

---

## Live on BSC testnet

`src/data/chain.ts` is written and `src/data/index.ts` is already flipped to
`chainAdapter`. The app reads and writes the contracts listed in
`src/config/deployment.ts`, which default to the BSC testnet deployment of
2026-08-13. The HCOW and USDT entries there are stand-in test tokens with no
value; the real HCOW token does not exist yet.

Point the same bundle at another network with Vite env vars, no code change:

```
VITE_CHAIN_ID  VITE_CHAIN_NAME  VITE_RPC_URL  VITE_EXPLORER_BASE
VITE_HCOW_ADDRESS  VITE_USDT_ADDRESS
VITE_PROFIT_SHARE_ADDRESS  VITE_STAKING_ADDRESS  VITE_LEDGER_ADDRESS
```

Chain identity now lives in `deployment.ts`; `constants.ts` re-exports it so
the wrong-network banner and the explorer links cannot disagree with the
adapter about which chain the app is on.

To go back to mock data, swap the two lines in `src/data/index.ts`.

### What is real and what is missing

Every method the stub file marked `[C]` is implemented against a real contract.
The `[I]` indexer methods and `[B]` backend methods have nothing behind them
yet, so they return zero, null or an empty list rather than an invented number.
Each one is named in the `CHAIN_ADAPTER_GAPS` export in `chain.ts`, which is
the list to work through, in this order:

1. Revenue and cost line items per epoch, and the chain-verifiable ratio. These
   are off-chain business records, not events, so no indexer can recover them.
   They need a backend the finance side writes to.
2. APR figures stay null until a methodology is agreed. The UI renders a dash.
3. `epoch_settlement` rows in transaction history, which need the indexer to
   replay each account's share history to attribute a settlement per user.

Transaction history, the rolling gross-received and burn windows, and the
settlement transaction hash now come from the event index. Set
`VITE_INDEXER_URL` and `VITE_INDEXER_KEY` to the Supabase project URL and its
anon key. Leave them empty and the app still works: those fields report empty
rather than guessing, exactly as before the index existed.

The contract side is closed. `participantCount` and `lifetimeOf(account)` were
added to `HCOWProfitShare` for exactly these fields, so participant count,
lifetime deducted HCOW and lifetime claimed USDT all read from chain.

### Verifying the read path without a browser

```bash
npx vite build --ssr src/data/__smoke.ts --outDir dist-node
node dist-node/__smoke.js 0x<address>
```

It stubs an EIP-1193 provider and calls every read method against the
configured RPC, printing what comes back. Run it after any ABI change: a
mis-typed tuple field shows up here instead of as a blank panel in the UI.

---

## What the VegasLedger team has to do

**One file: `src/data/chain.ts`.** Then flip one line in `src/data/index.ts`.

That is the whole job on this side. It is true here in a way it was not true in
the previous package: the UI imports the adapter only from `src/data/index.ts`,
and never touches a wallet, a contract or an HTTP endpoint directly. You can
verify it yourself:

```bash
grep -rn "from \"../data/mock\"\|from \"./mock\"\|from \"../data/chain\"" src --include=*.tsx
# returns nothing
```

Read the header comment in `src/data/chain.ts` first. It lists, per method,
which contract call, indexer query or backend endpoint sits behind it, and it
tags each one `[C]` contract, `[I]` indexer, `[B]` backend.

Read the header comment in `src/data/adapter.ts` second. It carries the
distribution policy, which is binding on the contracts as well as the UI.

`src/data/mock.ts` is the executable specification. Where prose and that file
disagree, that file wins. Your chain adapter must reproduce its observable
behaviour: same error codes, same null handling, same pending-then-confirmed
lifecycle, same guards.

---

## Layout

```
src/
├── main.tsx                 React entry
├── App.tsx                  shell: header, tab nav, banners, toast host, modal host
├── index.css                reset and keyframes only, no colour
│
├── config/
│   ├── constants.ts         PROTOCOL, LIMITS, FOUNDATION_NODES, EXTERNAL_LINKS
│   └── tokens.ts            design tokens. No hex value exists anywhere else
│
├── data/                    ← the only folder VegasLedger needs to touch
│   ├── adapter.ts           the interface and every type. Do not edit
│   ├── mock.ts              executable spec. Do not edit
│   ├── chain.ts             ← WRITE THIS
│   └── index.ts             ← FLIP THIS LINE
│
├── lib/
│   ├── format.ts            all display formatting
│   └── errors.ts            AdapterErrorCode → toast presentation, all 12 rows
│
├── hooks/
│   ├── useWallet.ts         event-based wallet state. No polling
│   ├── useAsync.ts          fetch on mount, explicit reload
│   └── useCountdown.ts      local 1s tick. Never calls the adapter
│
├── components/              UI kit, modal, toast, banners, wallet connect,
│                            EpochWaterfall
└── screens/                 Home, ProfitShare, NetworkStaking, Portfolio
```

---

## Rules the UI already relies on

Breaking any of these produces a visible defect, so they are listed here as
well as in `chain.ts`.

1. **Never resolve a write before 1 block confirmation.** The UI updates state
   the moment a `TxResult` resolves. There are no optimistic updates.
2. **Every failure throws `AdapterError` with one of the 12 codes.** A raw
   provider error reaching the UI collapses into a generic toast. Attach the
   original as `cause`.
3. **`TX_TIMEOUT` after 60s**, with `txHash` attached, and keep watching in the
   background.
4. **Amounts crossing the interface are human-readable numbers, not wei.**
   Convert at the adapter boundary and nowhere else.
5. **`getWalletState` never throws.** Disconnected returns
   `{connected:false, address:null, chainId:null, balances:{0,0,0}}`.
   Never a stale address.
6. **`subscribeWallet` fires once immediately, then on every account, chain and
   balance change.** The UI does not poll. Without this the app will show one
   account's balance while signing as another.
7. **`getEpoch` is cached per epoch.** It is read on mount; the countdown ticks
   locally and costs no RPC.
8. **Cooldown `readyAt` comes from chain state**, never `Date.now() + 7 days`.

---

## Testing the states the UI must handle

`src/data/mock.ts` exports `mockControls` for exactly this:

```ts
import { mockControls } from "./data/mock";

mockControls.setChainId(1);      // wrong-network banner
mockControls.setBnb(0.001);      // low-gas banner and INSUFFICIENT_BNB
mockControls.switchAccount();    // account change propagates through subscribeWallet
mockControls.expireCooldowns();  // makes pending withdrawals claimable now
```

---

## Constraints that are not negotiable

- The Profit Share warning banner cannot be dismissed, and first-time bonding
  requires the acknowledgement checkbox.
- APR fields are `number | null`. While null the UI renders a dash and
  "Methodology pending". Do not substitute a placeholder number. When a value
  is present the "Based on last epoch. Not guaranteed." disclaimer renders with it.
- No screen may display a USD conversion of HCOW, or any profit-and-loss figure.
- The product is **Profit Share**. Nothing may be labelled "Revenue Share".
- Gambling vocabulary is prohibited in user-facing copy. Revenue is described as
  "game revenue".

---

## Known open items, owned by HashCow

These are inputs the UI is already shaped for. None of them block starting.

| Item | Effect while open |
|---|---|
| APR methodology, both lanes | `estimatedAprPct` stays `null`, UI shows a dash |
| Minimum stake and minimum bond | `LIMITS` are `null`, no minimum enforced or shown |
| Representative naming | `FOUNDATION_NODES` placeholders render |
| Terms and Privacy pages | `EXTERNAL_LINKS` point at URLs that must exist by TGE |
| Slashing policy | Determines whether any stronger staking copy is permissible |
| `cancelUnstake` contract function | Does not exist yet in any artifact. UI and adapter both expect it |
