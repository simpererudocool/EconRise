import { applyPolitics, newPolitics, upgradeGame, PROVINCE_BY_ID, isOpenLand, branchActive } from './politics';
import type { Politics } from './politics';
import countryData from './countries.json';
export const GOODS = ['ore', 'grain', 'machines', 'provisions'] as const;
export type Good = (typeof GOODS)[number];
export type Stock = Record<Good, number>;
export type CountryId = 'canada' | 'brazil' | 'uk' | 'egypt' | 'south-africa' | 'india' | 'japan' | 'australia'
  | 'usa' | 'mexico' | 'argentina' | 'chile' | 'peru' | 'france' | 'germany' | 'spain' | 'italy' | 'norway'
  | 'turkey' | 'china' | 'indonesia' | 'south-korea' | 'nigeria' | 'kenya';
export const COUNTRIES = countryData as (Omit<(typeof countryData)[number], 'id'> & { id: CountryId })[];
export type Player = {
  id: string; name: string; country: CountryId; cash: number; goods: Stock;
  facilities: number; produced: number; traded: number; delivered: number;
};
export type Order = { id: string; owner: string; side: 'buy' | 'sell'; good: Good; quantity: number; price: number };
export type Loan = { id: string; borrower: string; lender?: string; principal: number; interest: number; good: Good; collateral: number };
export type Shipment = { id: string; owner: string; destination: CountryId; good: Good; quantity: number; reward: number };
export type Alliance = { id: string; from: string; to: string; accepted: boolean };
export type Branch = { id: string; owner: string; province: string };
export type Game = {
  schema: 3; revision: number; players: Record<string, Player>;
  branches: Branch[];
  politics: Politics;
  reserves: Record<CountryId, { ore: number; grain: number }>;
  orders: Order[]; loans: Loan[]; shipments: Shipment[]; alliances: Alliance[];
  history: { revision: number; text: string }[];
  prices: Partial<Record<Good, number>>;
};
export class RuleError extends Error {
  constructor(message: string, public status = 400) { super(message); this.name = 'RuleError'; }
}
export function newGame(): Game {
  return { schema: 3, revision: 0, players: {}, branches: [], politics: newPolitics(),
    reserves: Object.fromEntries(COUNTRIES.map(c => [c.id, { ore: 300, grain: 300 }])) as Game['reserves'],
    orders: [], loans: [], shipments: [], alliances: [], history: [], prices: {} };
}
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new RuleError(message); }
function integer(value: unknown, label: string, max = 10000): number {
  assert(typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= max, `${label} must be a whole number from 1 to ${max}.`); return value;
}
function good(value: unknown): Good { assert(GOODS.includes(value as Good), 'Unknown resource.'); return value as Good; }
function country(value: unknown): CountryId { assert(COUNTRIES.some(c => c.id === value), 'Choose a valid country.'); return value as CountryId; }
function text(value: unknown, label: string): string { assert(typeof value === 'string' && value.length <= 100, `Invalid ${label}.`); return value; }
function deduct(player: Player, resource: Good, amount: number) { assert(player.goods[resource] >= amount, `Not enough ${resource}.`); player.goods[resource] -= amount; }
function pay(player: Player, amount: number) { assert(player.cash >= amount, 'Not enough available credits.'); player.cash -= amount; }
function log(game: Game, message: string) { game.history.unshift({ revision: game.revision, text: message }); game.history = game.history.slice(0, 60); }
export function joinGame(state: Game, id: string, rawName: unknown, rawCountry: unknown): Game {
  assert(!state.players[id], 'This player already exists.');
  assert(Object.keys(state.players).length < 32, 'This world is full (32 players).');
  const name = text(rawName, 'name').trim();
  assert(/^[\p{L}\p{N} _.-]{2,24}$/u.test(name), 'Name must be 2–24 letters, numbers, spaces, dots, dashes or underscores.');
  assert(!Object.values(state.players).some(p => p.name.toLowerCase() === name.toLowerCase()), 'That name is already taken.');
  const selected = country(rawCountry);
  const game = structuredClone(upgradeGame(state)); game.revision++;
  game.players[id] = { id, name, country: selected, cash: 1000, goods: { ore: 12, grain: 12, machines: 2, provisions: 2 }, facilities: 0, produced: 0, traded: 0, delivered: 0 };
  log(game, `${name} established a company in ${COUNTRIES.find(c => c.id === selected)!.name}.`);
  return game;
}
/** Pure transition: no clocks, randomness, network, actors or background mutations. */
export function applyAction(state: Game, playerId: string, input: unknown): Game {
  assert(input && typeof input === 'object' && !Array.isArray(input), 'Invalid action.');
  const a = input as Record<string, unknown>;
  assert(typeof a.type === 'string', 'Missing action type.');
  const game = structuredClone(upgradeGame(state));
  const p = game.players[playerId]; assert(p, 'Player session no longer exists.');
  game.revision++; const id = `r${game.revision}`;
  let message = '';
  switch (a.type) {
    case 'extract': {
      assert(a.good === 'ore' || a.good === 'grain', 'Only ore and grain can be extracted.');
      let location = p.country;
      if (a.branch !== undefined) {
        const branch = game.branches.find(b => b.id === a.branch && b.owner === p.id);
        assert(branch, 'You do not own this branch.');
        assert(branchActive(game, branch), 'This branch is suspended by war or occupation.');
        location = PROVINCE_BY_ID[branch.province].country;
      }
      const c = COUNTRIES.find(c => c.id === location)!;
      const amount = integer(a.quantity, 'Quantity', c[a.good]);
      assert(game.reserves[location][a.good] >= amount, 'That shared reserve is exhausted.');
      game.reserves[location][a.good] -= amount; p.goods[a.good] += amount;
      message = `${p.name} extracted ${amount} ${a.good} in ${c.name}.`; break;
    }
    case 'open-branch': {
      assert(typeof a.province === 'string' && Object.hasOwn(PROVINCE_BY_ID, a.province), 'Unknown province.');
      const info = PROVINCE_BY_ID[a.province], province = game.politics.provinces[info.id];
      assert(a.version === province.version, 'Province changed since you viewed it. Refresh before acting.');
      assert(isOpenLand(game, info.id), 'Open branches only on peaceful, unconquered land.');
      assert(!game.branches.some(b => b.province === info.id), 'This province already has a business branch.');
      assert(game.branches.filter(b => b.owner === p.id).length < 6, 'Maximum of six branches per company.');
      deduct(p, 'machines', 2); deduct(p, 'provisions', 2);
      game.branches.push({ id, owner: p.id, province: info.id }); province.version = game.revision;
      message = `${p.name} opened a business branch in ${info.name} (2 machines + 2 provisions).`; break;
    }
    case 'close-branch': {
      const branch = game.branches.find(b => b.id === a.id && b.owner === p.id);
      assert(branch, 'Only the branch owner can close it.');
      game.branches = game.branches.filter(b => b.id !== branch.id);
      game.politics.provinces[branch.province].version = game.revision;
      message = `${p.name} closed a business branch. Setup goods are not refunded.`; break;
    }
    case 'produce': {
      assert(a.good === 'machines' || a.good === 'provisions', 'Choose machines or provisions.');
      const amount = integer(a.quantity, 'Batch', 2 + p.facilities);
      deduct(p, 'ore', amount * (a.good === 'machines' ? 2 : 1));
      deduct(p, 'grain', amount * (a.good === 'provisions' ? 2 : 1));
      p.goods[a.good] += amount; p.produced += amount;
      message = `${p.name} manufactured ${amount} ${a.good}.`; break;
    }
    case 'build': {
      assert(p.facilities < 8, 'Maximum of eight workshops per company.');
      deduct(p, 'machines', 4); p.facilities++;
      message = `${p.name} built a workshop. Batch capacity is now ${2 + p.facilities}.`; break;
    }
    case 'order': {
      assert(a.side === 'buy' || a.side === 'sell', 'Choose buy or sell.');
      assert(game.orders.filter(o => o.owner === p.id).length < 12, 'Maximum of 12 open orders.');
      const resource = good(a.good), amount = integer(a.quantity, 'Quantity', 1000), price = integer(a.price, 'Price', 10000);
      if (a.side === 'sell') deduct(p, resource, amount); else pay(p, amount * price);
      game.orders.push({ id, owner: p.id, side: a.side, good: resource, quantity: amount, price });
      message = `${p.name} posted a ${a.side} order: ${amount} ${resource} at ${price} cr.`; break;
    }
    case 'cancel': {
      const order = game.orders.find(o => o.id === a.id); assert(order, 'That order is no longer open.');
      assert(order.owner === p.id, 'Only the owner can cancel an order.');
      if (order.side === 'sell') p.goods[order.good] += order.quantity; else p.cash += order.quantity * order.price;
      game.orders = game.orders.filter(o => o.id !== order.id); message = `${p.name} cancelled an order.`; break;
    }
    case 'fill': {
      const order = game.orders.find(o => o.id === a.id); assert(order, 'That order was already filled or cancelled.');
      assert(order.owner !== p.id, 'You cannot trade with yourself.');
      const amount = integer(a.quantity, 'Quantity', 1000); assert(amount <= order.quantity, 'Only the remaining order quantity is available.');
      const maker = game.players[order.owner], total = amount * order.price;
      if (order.side === 'sell') { pay(p, total); maker.cash += total; p.goods[order.good] += amount; }
      else { deduct(p, order.good, amount); maker.goods[order.good] += amount; p.cash += total; }
      maker.traded += total; p.traded += total; order.quantity -= amount;
      game.orders = game.orders.filter(o => o.quantity > 0); game.prices[order.good] = order.price;
      message = `${p.name} traded ${amount} ${order.good} with ${maker.name} at ${order.price} cr.`; break;
    }
    case 'request-loan': {
      assert(game.loans.filter(l => l.borrower === p.id).length < 4, 'Maximum of four loan contracts.');
      const principal = integer(a.principal, 'Principal', 10000);
      assert(typeof a.interest === 'number' && Number.isSafeInteger(a.interest) && a.interest >= 0 && a.interest <= principal, 'Interest must be a whole number from zero to principal.');
      const resource = good(a.good), amount = integer(a.collateral, 'Collateral', 1000); deduct(p, resource, amount);
      game.loans.push({ id, borrower: p.id, principal, interest: a.interest, good: resource, collateral: amount });
      message = `${p.name} requested a ${principal} cr loan with ${a.interest} cr interest.`; break;
    }
    case 'fund-loan': {
      const loan = game.loans.find(l => l.id === a.id); assert(loan && !loan.lender, 'That loan request is no longer available.');
      assert(loan.borrower !== p.id, 'You cannot lend to yourself.'); pay(p, loan.principal);
      game.players[loan.borrower].cash += loan.principal; loan.lender = p.id;
      message = `${p.name} funded ${game.players[loan.borrower].name}'s loan.`; break;
    }
    case 'close-loan': {
      const loan = game.loans.find(l => l.id === a.id); assert(loan && loan.borrower === p.id, 'Only the borrower can close this loan.');
      if (!loan.lender) p.goods[loan.good] += loan.collateral;
      else if (a.surrender === true) game.players[loan.lender].goods[loan.good] += loan.collateral;
      else { pay(p, loan.principal + loan.interest); game.players[loan.lender].cash += loan.principal + loan.interest; p.goods[loan.good] += loan.collateral; }
      game.loans = game.loans.filter(l => l.id !== loan.id);
      message = `${p.name} ${loan.lender ? (a.surrender === true ? 'settled a loan with collateral' : 'repaid a loan') : 'withdrew a loan request'}.`; break;
    }
    case 'shipment': {
      assert(game.shipments.filter(s => s.owner === p.id).length < 4, 'Maximum of four open freight contracts.');
      const destination = country(a.destination); assert(destination !== p.country, 'Choose a destination outside your home country.');
      const resource = good(a.good), amount = integer(a.quantity, 'Cargo', 100), reward = integer(a.reward, 'Reward', 1000);
      deduct(p, resource, amount); pay(p, reward);
      game.shipments.push({ id, owner: p.id, destination, good: resource, quantity: amount, reward });
      message = `${p.name} offered ${reward} cr to deliver ${amount} ${resource}.`; break;
    }
    case 'deliver': {
      const shipment = game.shipments.find(s => s.id === a.id); assert(shipment, 'That shipment is no longer available.');
      assert(shipment.owner !== p.id, 'A freight contract needs another player.');
      assert(p.country === shipment.destination || game.branches.some(b => b.owner === p.id && PROVINCE_BY_ID[b.province].country === shipment.destination && branchActive(game, b)), 'Only a company resident or active branch in the destination country can deliver.');
      deduct(p, 'provisions', 1); p.goods[shipment.good] += shipment.quantity; p.cash += shipment.reward; p.delivered++;
      game.shipments = game.shipments.filter(s => s.id !== shipment.id);
      message = `${p.name} delivered ${shipment.quantity} ${shipment.good} for ${shipment.reward} cr (cargo is payment in kind).`; break;
    }
    case 'cancel-shipment': {
      const shipment = game.shipments.find(s => s.id === a.id); assert(shipment && shipment.owner === p.id, 'Only the owner can cancel this shipment.');
      p.goods[shipment.good] += shipment.quantity; p.cash += shipment.reward;
      game.shipments = game.shipments.filter(s => s.id !== shipment.id); message = `${p.name} withdrew a freight contract.`; break;
    }
    case 'invite': {
      const target = text(a.target, 'player'); assert(game.players[target] && target !== p.id, 'Choose another player.');
      assert(!game.alliances.some(l => (l.from === p.id && l.to === target) || (l.to === p.id && l.from === target)), 'An invitation or alliance already exists.');
      game.alliances.push({ id, from: p.id, to: target, accepted: false }); message = `${p.name} proposed an alliance to ${game.players[target].name}.`; break;
    }
    case 'alliance': {
      const alliance = game.alliances.find(l => l.id === a.id); assert(alliance, 'Alliance not found.');
      assert(alliance.from === p.id || alliance.to === p.id, 'You are not a party to this alliance.');
      if (a.accept === true) { assert(alliance.to === p.id && !alliance.accepted, 'Only the invited player can accept.'); alliance.accepted = true; message = `${p.name} accepted an alliance.`; }
      else { game.alliances = game.alliances.filter(l => l.id !== alliance.id); message = `${p.name} ended an invitation or alliance.`; }
      break;
    }
    default: {
      const result = applyPolitics(game, p, a);
      assert(result !== undefined, 'Unknown action.'); message = result;
    }
  }
  for (const player of Object.values(game.players)) {
    assert(Number.isSafeInteger(player.cash) && player.cash >= 0 && Object.values(player.goods).every(n => Number.isSafeInteger(n) && n >= 0), 'Action exceeds economy limits.');
  }
  log(game, message); return game;
}
export function capital(game: Game, p: Player): number {
  const escrow = game.orders.filter(o => o.owner === p.id && o.side === 'buy').reduce((n, o) => n + o.quantity * o.price, 0)
    + game.shipments.filter(s => s.owner === p.id).reduce((n, s) => n + s.reward, 0);
  const receivables = game.loans.filter(l => l.lender === p.id).reduce((n, l) => n + l.principal, 0);
  const debts = game.loans.filter(l => l.borrower === p.id && l.lender).reduce((n, l) => n + l.principal + l.interest, 0);
  return p.cash + escrow + receivables - debts;
}
