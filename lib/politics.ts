import territoryData from './territories.json';
import countryData from './countries.json';
import { RuleError } from './game';
import type { Branch, CountryId, Game, Player } from './game';
export type ProvinceInfo = { id: string; country: CountryId; name: string; neighbors: string[]; entry: boolean };
export const PROVINCES = territoryData.provinces as ProvinceInfo[];
export const CAPITALS = territoryData.capitals as Record<CountryId, string>;
export const PROVINCE_BY_ID = Object.fromEntries(PROVINCES.map(p => [p.id, p])) as Record<string, ProvinceInfo>;
export type Government = { leader: string | null; mode: 'founding' | 'elected' | 'revolution'; mandate: number };
export type ProvinceState = { controller: string; garrison: number; version: number };
export type Election = { id: string; country: CountryId; candidate: string; electorate: string[]; votes: string[] };
export type Rebellion = { id: string; country: CountryId; player: string };
export type War = { id: string; a: CountryId; b: CountryId; peaceBy?: CountryId };
export type Politics = { governments: Record<CountryId, Government>; provinces: Record<string, ProvinceState>; elections: Election[]; rebellions: Rebellion[]; wars: War[] };
export function newPolitics(): Politics {
  return {
    governments: Object.fromEntries(Object.keys(CAPITALS).map(c => [c, { leader: null, mode: 'founding', mandate: 0 }])) as Politics['governments'],
    provinces: Object.fromEntries(PROVINCES.map(p => [p.id, { controller: p.country, garrison: 0, version: 0 }])),
    elections: [], rebellions: [], wars: [],
  };
}
/** Compatibility migration adds neutral metadata only, never a grant or leader. */
export function upgradeGame(state: Game): Game {
  if (state.schema === 3 && state.politics && state.branches) return state;
  const defaults = newPolitics();
  const politics = state.politics ? {
    ...state.politics,
    governments: { ...defaults.governments, ...state.politics.governments },
    provinces: { ...defaults.provinces, ...state.politics.provinces },
  } : defaults;
  return { ...state, schema: 3, branches: state.branches || [], politics,
    reserves: { ...Object.fromEntries(countryData.map(c => [c.id, { ore: 300, grain: 300 }])), ...state.reserves } as Game['reserves'] };
}
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new RuleError(message); }
function country(value: unknown): CountryId { check(typeof value === 'string' && Object.hasOwn(CAPITALS, value), 'Unknown country.'); return value as CountryId; }
function units(value: unknown, minimum = 1): number { check(typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum && value <= 50, `Commit ${minimum}–50 whole units.`); return value; }
function consume(p: Player, machines: number, provisions = machines) {
  check(p.goods.machines >= machines && p.goods.provisions >= provisions, `Requires ${machines} machines and ${provisions} provisions in available stock.`);
  p.goods.machines -= machines; p.goods.provisions -= provisions;
}
export function rebelFaction(playerId: string) { return `rebel:${playerId}`; }
export function factionName(game: Game, faction: string): string {
  if (faction.startsWith('rebel:')) return `${game.players[faction.slice(6)]?.name || 'Former'} rebels`;
  return countryData.find(c => c.id === faction)?.name || faction;
}
export function isOpenLand(game: Game, provinceId: string): boolean {
  const info = PROVINCE_BY_ID[provinceId], province = game.politics.provinces[provinceId];
  return !!info && !!province && province.controller === info.country
    && !game.politics.wars.some(w => w.a === info.country || w.b === info.country)
    && !game.politics.rebellions.some(r => r.country === info.country);
}
export function branchActive(game: Game, branch: Branch): boolean {
  const owner = game.players[branch.owner], info = PROVINCE_BY_ID[branch.province];
  return !!owner && !!info && isOpenLand(game, branch.province);
}
export function controls(game: Game, player: Player): string {
  return game.politics.rebellions.some(r => r.player === player.id) ? rebelFaction(player.id) : player.country;
}
export function canCommand(game: Game, player: Player): boolean {
  return game.politics.governments[player.country].leader === player.id || game.politics.rebellions.some(r => r.player === player.id);
}
function finishRevolution(game: Game, rebellion: Rebellion): string {
  const politics = game.politics, faction = rebelFaction(rebellion.player);
  const regions = PROVINCES.filter(p => p.country === rebellion.country);
  const count = regions.filter(p => politics.provinces[p.id].controller === faction).length;
  if (politics.provinces[CAPITALS[rebellion.country]].controller !== faction || count <= regions.length / 2) return '';
  politics.governments[rebellion.country] = { leader: rebellion.player, mode: 'revolution', mandate: game.revision };
  for (const region of regions) {
    const province = politics.provinces[region.id];
    if (province.controller === faction) { province.controller = rebellion.country; province.version = game.revision; }
  }
  politics.rebellions = politics.rebellions.filter(r => r.id !== rebellion.id);
  politics.elections = politics.elections.filter(e => e.country !== rebellion.country);
  return ` ${game.players[rebellion.player].name} controls the capital and a provincial majority and now leads ${factionName(game, rebellion.country)}.`;
}
function targetProvince(game: Game, action: Record<string, unknown>) {
  check(typeof action.province === 'string' && Object.hasOwn(PROVINCE_BY_ID, action.province), 'Unknown province.');
  const info = PROVINCE_BY_ID[action.province], province = game.politics.provinces[info.id];
  check(typeof action.version === 'number' && action.version === province.version, 'Province changed since you viewed it. Refresh before acting.');
  return { info, province };
}
function fight(game: Game, faction: string, info: ProvinceInfo, province: ProvinceState, amount: number): string {
  const defense = province.garrison;
  // Both sides spend only resources previously deployed by humans. Ties defend.
  if (amount > defense) { province.controller = faction; province.garrison = amount - defense; }
  else province.garrison = defense - amount;
  province.version = game.revision;
  return `${info.name}: attack ${amount} vs defense ${defense}. ${amount > defense ? `${factionName(game, faction)} captured the province` : 'Defender retained the province (ties defend)'}.`;
}
export function applyPolitics(game: Game, p: Player, a: Record<string, unknown>): string | undefined {
  const politics = game.politics, home = politics.governments[p.country];
  const id = `r${game.revision}`;
  switch (a.type) {
    case 'claim-government': {
      check(!home.leader, 'This country already has a leader; use elections or rebellion.');
      check(!politics.rebellions.some(r => r.country === p.country), 'Resolve the rebellion before founding a government.');
      consume(p, 4); home.leader = p.id; home.mode = 'founding'; home.mandate = game.revision;
      return `${p.name} invested 4 machines and 4 provisions to found the government of ${factionName(game, p.country)}.`;
    }
    case 'nominate': {
      check(home.leader && home.leader !== p.id, 'A resident can challenge an existing leader.');
      check(!politics.rebellions.some(r => r.country === p.country), 'Elections are suspended during a rebellion.');
      check(!politics.elections.some(e => e.country === p.country), 'An election is already open.');
      consume(p, 2);
      politics.elections.push({ id, country: p.country, candidate: p.id, electorate: Object.values(game.players).filter(v => v.country === p.country).map(v => v.id).sort(), votes: [] });
      return `${p.name} opened a resident election. A strict majority of its frozen electorate must explicitly vote.`;
    }
    case 'vote': {
      const election = politics.elections.find(e => e.id === a.id); check(election, 'This election is closed.');
      check(election.electorate.includes(p.id), 'Only residents registered when the election opened can vote.');
      check(!election.votes.includes(p.id), 'You already voted.'); election.votes.push(p.id);
      if (election.votes.length > election.electorate.length / 2) {
        politics.governments[election.country] = { leader: election.candidate, mode: 'elected', mandate: game.revision };
        politics.elections = politics.elections.filter(e => e.id !== election.id);
        return `${p.name} voted. ${game.players[election.candidate].name} won the resident majority and leads ${factionName(game, election.country)}.`;
      }
      return `${p.name} voted for ${game.players[election.candidate].name} (${election.votes.length}/${election.electorate.length}).`;
    }
    case 'withdraw-election': {
      const election = politics.elections.find(e => e.id === a.id); check(election && election.candidate === p.id, 'Only the candidate can withdraw.');
      politics.elections = politics.elections.filter(e => e.id !== election.id); return `${p.name} withdrew their candidacy; campaign goods are not refunded.`;
    }
    case 'rebel': {
      check(home.leader && home.leader !== p.id, 'A rebellion needs another human-led home government.');
      check(!politics.rebellions.some(r => r.country === p.country), 'A rebellion already exists in this country.');
      const { info, province } = targetProvince(game, a);
      check(info.country === p.country && province.controller === p.country, 'Start in a province held by your home government.');
      const amount = units(a.units, 6); consume(p, 4 + amount);
      const rebellion = { id, country: p.country, player: p.id }; politics.rebellions.push(rebellion);
      politics.elections = politics.elections.filter(e => e.country !== p.country);
      return `${p.name} launched a rebellion (4 machines + 4 provisions organization cost). ${fight(game, rebelFaction(p.id), info, province, amount)}${finishRevolution(game, rebellion)}`;
    }
    case 'abandon-rebellion': {
      const rebellion = politics.rebellions.find(r => r.player === p.id); check(rebellion, 'You do not lead a rebellion.');
      for (const province of Object.values(politics.provinces)) if (province.controller === rebelFaction(p.id)) {
        province.controller = p.country; province.garrison = 0; province.version = game.revision;
      }
      politics.rebellions = politics.rebellions.filter(r => r.id !== rebellion.id);
      return `${p.name} disbanded their rebellion. Held provinces returned to home control; deployed goods were consumed.`;
    }
    case 'deploy': {
      check(canCommand(game, p), 'Only a government leader or rebel commander can deploy.');
      const { info, province } = targetProvince(game, a), faction = controls(game, p);
      check(province.controller === faction, 'You can reinforce only provinces your faction controls.');
      const amount = units(a.units); check(province.garrison + amount <= 100, 'Province garrison cap is 100.'); consume(p, amount);
      province.garrison += amount; province.version = game.revision;
      return `${p.name} deployed ${amount} garrison units in ${info.name} (1 machine + 1 provision per unit).`;
    }
    case 'declare-war': {
      check(home.leader === p.id && !politics.rebellions.some(r => r.player === p.id), 'Only your national leader may declare war.');
      const target = country(a.country); check(target !== p.country && politics.governments[target].leader, 'Choose another human-governed country.');
      check(!politics.wars.some(w => (w.a === p.country && w.b === target) || (w.b === p.country && w.a === target)), 'These countries are already at war.');
      consume(p, 2); politics.wars.push({ id, a: p.country, b: target });
      return `${p.name} declared war on ${factionName(game, target)} (2 machines + 2 provisions mobilization).`;
    }
    case 'attack': {
      check(canCommand(game, p), 'Only a government leader or rebel commander can attack.');
      const { info, province } = targetProvince(game, a), faction = controls(game, p);
      check(province.controller !== faction, 'You already control this province.');
      const rebellion = politics.rebellions.find(r => r.player === p.id);
      if (rebellion) check(info.country === p.country, 'Rebels can fight only in their home country.');
      else {
        if (province.controller.startsWith('rebel:')) check(info.country === p.country, 'Only the home government may suppress this rebellion.');
        else {
          const enemy = country(province.controller);
          check(politics.wars.some(w => (w.a === p.country && w.b === enemy) || (w.b === p.country && w.a === enemy)), 'Declare war before attacking foreign control.');
        }
      }
      const adjacent = info.neighbors.some(n => politics.provinces[n]?.controller === faction);
      const abroad = !rebellion && info.country !== p.country;
      // Explicit expedition permits overseas wars, but inland advances must
      // follow verified province adjacency. No hidden marching or path timers.
      const expedition = abroad && !adjacent && info.entry;
      const domesticRecovery = !rebellion && info.country === p.country && !PROVINCES.some(r => r.country === p.country && politics.provinces[r.id].controller === faction) && info.entry;
      check(adjacent || expedition || domesticRecovery, 'No adjacent controlled province. Overseas entry is limited to exterior-border provinces.');
      const amount = units(a.units); consume(p, amount, amount + (expedition || domesticRecovery ? 3 : 0));
      return `${p.name} ${expedition || domesticRecovery ? 'launched an expedition (+3 provisions)' : 'advanced'}. ${fight(game, faction, info, province, amount)}${rebellion ? finishRevolution(game, rebellion) : ''}`;
    }
    case 'peace': {
      check(home.leader === p.id, 'Only a national leader can negotiate peace.');
      const war = politics.wars.find(w => w.id === a.id); check(war && (war.a === p.country || war.b === p.country), 'You are not a party to this war.');
      if (a.accept === true) {
        check(war.peaceBy && war.peaceBy !== p.country, 'The other country must first offer peace.');
        politics.wars = politics.wars.filter(w => w.id !== war.id);
        return `${p.name} accepted peace. Both countries keep their currently controlled provinces; no automatic restitution.`;
      }
      war.peaceBy = p.country; return `${p.name} offered peace. The other country's human leader must accept.`;
    }
    default: return undefined;
  }
}
