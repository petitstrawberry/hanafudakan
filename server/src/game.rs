//! Authoritative, transport-independent two-player koi-koi rules.
//!
//! Card IDs are `month * 4 + variant`, with zero-based months. Only the server
//! owns this state; clients receive a view that hides the other hand and stock.

use rand::seq::SliceRandom;
use rand::{rngs::StdRng, SeedableRng};
use serde::Serialize;

const BRIGHTS: [u8; 5] = [0, 8, 28, 40, 44];
const ANIMALS: [u8; 9] = [4, 12, 16, 20, 24, 29, 32, 36, 41];
const RIBBONS: [u8; 10] = [1, 5, 9, 13, 17, 21, 25, 33, 37, 42];
const HYPER_DRAW_LIMIT: u8 = 4;
const DUEL_HP: u8 = 18;

#[derive(Debug, Clone, Copy)]
enum ResetPolicy {
    All,
    #[cfg(test)]
    KeepOpponent,
    #[cfg(test)]
    KeepBestRole,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HyperBeat {
    pub chain: [u8; 2],
    pub bloom: [u32; 2],
    pub multiplier: [u32; 2],
    pub hp: Option<[u8; 2]>,
    pub counter_draw: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HandTargets {
    pub card_id: u8,
    pub targets: Vec<u8>,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Play,
    DrawChoice,
    Decision,
    RoundEnd,
    Finished,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct Yaku {
    pub name: String,
    pub points: u32,
}

/// A Hyper contract is deliberately part of the authoritative game state. It
/// is public room information, but its effects are only executed by `Game`.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HyperContract {
    pub id: String,
    pub name: String,
    pub source: String,
    pub points: u32,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HyperOption {
    pub role: String,
    pub contract: HyperContract,
    pub points: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HyperState {
    pub contracts: [Vec<HyperContract>; 2],
    pub stake: [u32; 2],
    pub bloom: [u32; 2],
    pub chain: [u8; 2],
    pub sealed: [Vec<u8>; 2],
    pub options: Vec<HyperOption>,
    pub multiplier: [u32; 2],
    pub projected: [u32; 2],
    pub hp: Option<[u8; 2]>,
    pub hp_max: u8,
    pub boosts: [u8; 2],
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PublicGameEventSource {
    Hand,
    Draw,
    Choice,
}

/// An ordered movement and its resulting public board. Neither hands nor the
/// unrevealed stock belong in this snapshot, including for spectators.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PublicGameEvent {
    pub id: u64,
    pub player: usize,
    pub source: PublicGameEventSource,
    pub card_id: u8,
    pub target_ids: Vec<u8>,
    pub captured: bool,
    pub field: Vec<u8>,
    pub captured_cards: [Vec<u8>; 2],
    pub deck_count: usize,
    pub requires_choice: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hyper: Option<HyperBeat>,
}

#[derive(Debug, Clone)]
pub struct Game {
    rng: StdRng,
    reset_policy: ResetPolicy,
    /// Hyper is a ruleset layered on the same room/game protocol. Standard
    /// rooms leave this false and retain the original koi-koi scoring.
    pub hyper: bool,
    pub rounds: u8,
    pub round: u8,
    pub dealer: usize,
    pub turn: usize,
    pub phase: Phase,
    pub hands: [Vec<u8>; 2],
    pub captured: [Vec<u8>; 2],
    pub field: Vec<u8>,
    pub deck: Vec<u8>,
    pub drawn_card: Option<u8>,
    pub koikoi: [u8; 2],
    pub scores: [u32; 2],
    /// The current round's winner; use `match_winner` for the match result.
    pub winner: Option<usize>,
    pub round_points: u32,
    pub hyper_contracts: [Vec<HyperContract>; 2],
    pub hyper_stake: [u32; 2],
    pub hyper_bloom: [u32; 2],
    pub hyper_chain: [u8; 2],
    pub hyper_sealed: [Vec<u8>; 2],
    pub board_revision: u32,
    pub hyper_hp: Option<[u8; 2]>,
    hyper_boosts: [u8; 2],
    hyper_turn_captures: [u8; 2],
    hyper_miss_used: [bool; 2],
    hyper_pending_draws: [u8; 2],
    hyper_draws_used: [u8; 2],
    hyper_beast_used: [u8; 2],
    hyper_feast_used: [u8; 2],
    hyper_hunt_used: [u8; 2],
    hyper_ink_used: [u8; 2],
    hyper_grass_used: [u8; 2],
    hyper_overdrive_used: [u8; 2],
    pub log: Vec<String>,
    pub events: Vec<PublicGameEvent>,
    event_seq: u64,
    checkpoint: [u32; 2],
    hyper_captured: [u8; 2],
    forfeited_winner: Option<usize>,
    #[cfg(test)]
    balance_variant: u8,
}

impl Game {
    pub fn new(rounds: u8) -> Self {
        Self::with_rng(rounds, false, StdRng::from_entropy())
    }

    fn with_rng(rounds: u8, hyper: bool, rng: StdRng) -> Self {
        let mut game = Self {
            rng,
            reset_policy: ResetPolicy::All,
            hyper,
            rounds: rounds.clamp(1, 12),
            round: 1,
            dealer: 0,
            turn: 0,
            phase: Phase::Play,
            hands: [vec![], vec![]],
            captured: [vec![], vec![]],
            field: vec![],
            deck: vec![],
            drawn_card: None,
            koikoi: [0; 2],
            scores: [0; 2],
            winner: None,
            round_points: 0,
            hyper_contracts: [vec![], vec![]],
            hyper_stake: [0; 2],
            hyper_bloom: [0; 2],
            hyper_chain: [0; 2],
            hyper_sealed: [vec![], vec![]],
            board_revision: 0,
            hyper_hp: None,
            hyper_boosts: [0; 2],
            hyper_turn_captures: [0; 2],
            hyper_miss_used: [false; 2],
            hyper_pending_draws: [0; 2],
            hyper_draws_used: [0; 2],
            hyper_beast_used: [0; 2],
            hyper_feast_used: [0; 2],
            hyper_hunt_used: [0; 2],
            hyper_ink_used: [0; 2],
            hyper_grass_used: [0; 2],
            hyper_overdrive_used: [0; 2],
            log: vec![],
            events: vec![],
            event_seq: 0,
            checkpoint: [0; 2],
            hyper_captured: [0; 2],
            forfeited_winner: None,
            #[cfg(test)]
            balance_variant: 3,
        };
        game.deal();
        game
    }

    pub fn new_hyper(rounds: u8) -> Self {
        Self::with_rng(rounds, true, StdRng::from_entropy())
    }

    /// Seed a new match from the room's last event ID. Never rewind an active
    /// game's sequence, so reconnecting clients cannot mistake a new movement
    /// for an event they have already played.
    pub fn set_event_sequence(&mut self, sequence: u64) {
        self.event_seq = self.event_seq.max(sequence);
    }

    pub fn event_sequence(&self) -> u64 {
        self.event_seq
    }

    /// Every public action validates a clone and commits only on success.
    /// In particular, a bad capture target must not consume the played card.
    fn transaction(
        &mut self,
        action: impl FnOnce(&mut Self) -> Result<(), String>,
    ) -> Result<(), String> {
        let mut next = self.clone();
        action(&mut next)?;
        *self = next;
        Ok(())
    }

    pub fn play(&mut self, player: usize, card: u8, target: Option<u8>) -> Result<(), String> {
        self.transaction(|game| {
            game.require_turn(player, Phase::Play)?;
            let index = game.hands[player]
                .iter()
                .position(|&held| held == card)
                .ok_or("手札にない札です。")?;
            let matches = game.matching(card);
            game.validate_target(&matches, target)?;
            game.hands[player].remove(index);
            let targets = game.capture_or_place(player, card, &matches, target);
            game.push_event(player, PublicGameEventSource::Hand, card, targets, false);
            if !game.finish_hyper_duel() { game.draw(); }
            Ok(())
        })
    }

    pub fn choose(&mut self, player: usize, target: u8) -> Result<(), String> {
        self.transaction(|game| {
            game.require_turn(player, Phase::DrawChoice)?;
            let card = game.drawn_card.ok_or("選ぶ札がありません。")?;
            let matches = game.matching(card);
            game.validate_target(&matches, Some(target))?;
            game.drawn_card = None;
            let targets = game.capture_or_place(player, card, &matches, Some(target));
            game.push_event(player, PublicGameEventSource::Choice, card, targets, false);
            game.finish_draw_chain();
            Ok(())
        })
    }

    pub fn decision(&mut self, player: usize, koikoi: bool) -> Result<(), String> {
        self.transaction(|game| {
            game.require_turn(player, Phase::Decision)?;
            let points = total(&evaluate(&game.active_captured(player)));
            if points == 0 || points <= game.checkpoint[player] {
                return Err("新しい役が成立していません。".into());
            }
            if !koikoi && !game.can_cash_out(player) {
                return Err(format!("契約者のあがりには{}文以上の役が必要です。", game.cashout_minimum(player)));
            }
            if koikoi {
                if game.exhausted() {
                    return Err("最後の札です。「勝負」で得点を確定してください。".into());
                }
                game.checkpoint[player] = points;
                game.koikoi[player] += 1;
                if game.hyper { game.add_hyper_boost(player, 2); }
                game.push_log(format!("{}番手、こいこい！", player + 1));
                game.advance_turn();
            } else {
                let round_points = if game.hyper {
                    game.hyper_payout(player, 0)
                } else {
                    let multiplier = if points >= 7 { 2 } else { 1 }
                        * if game.koikoi[1 - player] > 0 { 2 } else { 1 };
                    points * multiplier
                };
                game.settle(Some(player), round_points);
            }
            Ok(())
        })
    }

    pub fn next_round(&mut self) -> Result<(), String> {
        self.transaction(|game| {
            if game.phase != Phase::RoundEnd || game.round >= game.rounds {
                return Err("次の局にはまだ進めません。".into());
            }
            if let Some(winner) = game.winner {
                game.dealer = winner;
            } else {
                game.dealer = 1 - game.dealer;
            }
            game.round += 1;
            game.deal();
            Ok(())
        })
    }

    /// An explicit resignation ends the match, regardless of the score.
    pub fn forfeit(&mut self, player: usize) -> Result<(), String> {
        self.transaction(|game| {
            if player > 1 {
                return Err("無効なプレイヤーです。".into());
            }
            if game.phase == Phase::Finished {
                return Err("対局は終了しています。".into());
            }
            game.phase = Phase::Finished;
            game.winner = Some(1 - player);
            game.forfeited_winner = game.winner;
            game.round_points = 0;
            game.push_log(format!("{}番手が投了しました。", player + 1));
            Ok(())
        })
    }

    pub fn match_winner(&self) -> Option<usize> {
        if self.phase != Phase::Finished {
            return None;
        }
        self.forfeited_winner
            .or_else(|| match self.scores[0].cmp(&self.scores[1]) {
                std::cmp::Ordering::Greater => Some(0),
                std::cmp::Ordering::Less => Some(1),
                std::cmp::Ordering::Equal => None,
            })
    }

    pub fn legal_targets(&self) -> Vec<u8> {
        if self.phase == Phase::DrawChoice {
            self.drawn_card
                .map(|card| self.matching(card))
                .unwrap_or_default()
        } else {
            vec![]
        }
    }

    pub fn hand_targets(&self, player: usize) -> Vec<HandTargets> {
        if self.phase != Phase::Play || self.turn != player { return vec![]; }
        self.hands[player].iter().map(|&card_id| HandTargets {
            card_id, targets: self.matching(card_id),
        }).collect()
    }

    pub fn yaku(&self) -> [Vec<Yaku>; 2] {
        [
            evaluate(&self.active_captured(0)),
            evaluate(&self.active_captured(1)),
        ]
    }

    pub fn hyper_options(&self, player: usize) -> Vec<HyperOption> {
        if !self.hyper || player > 1 || self.turn != player || self.phase != Phase::Decision {
            return vec![];
        }
        let owned = self.hyper_contracts[player]
            .iter()
            .map(|contract| contract.id.as_str())
            .collect::<std::collections::HashSet<_>>();
        evaluate(&self.active_captured(player))
            .into_iter()
            .filter_map(|role| {
                let contract = hyper_contract_for_role(&role.name)?;
                (!owned.contains(contract.id.as_str()) && self.hyper_contracts[player].len() < 3)
                    .then_some(HyperOption {
                        role: role.name,
                        points: role.points,
                        contract,
                    })
            })
            .collect()
    }

    fn cashout_minimum(&self, player: usize) -> u32 {
        if !self.hyper || !self.use_cashout_threshold() { return 0; }
        self.hyper_contracts[player].iter().map(|contract| contract.points).max().unwrap_or(0)
    }

    fn can_cash_out(&self, player: usize) -> bool {
        let minimum = self.cashout_minimum(player);
        minimum == 0 || evaluate(&self.active_captured(player))
            .iter().any(|role| role.points >= minimum)
    }

    #[cfg(test)]
    fn use_cashout_threshold(&self) -> bool { self.balance_variant != 0 && self.balance_variant != 2 }
    #[cfg(not(test))]
    fn use_cashout_threshold(&self) -> bool { true }

    fn counter_draw_budget(&self, player: usize) -> u8 {
        if !self.hyper || !self.hyper_contracts[player].is_empty()
            || self.hyper_contracts[1 - player].is_empty() { return 0; }
        let chain = self.hyper_chain[1 - player];
        #[cfg(test)]
        return match self.balance_variant {
            0 | 1 => 0,
            2 | 3 => u8::from(chain >= 3),
            4 => 1,
            5 => if chain >= 3 { 2 } else { 0 },
            7 => 2,
            _ => if chain >= 3 { 2 } else { 1 },
        };
        #[cfg(not(test))]
        { u8::from(chain >= 3) }
    }

    pub fn hyper(&mut self, player: usize, role: String) -> Result<(), String> {
        self.transaction(|game| {
            game.require_turn(player, Phase::Decision)?;
            if !game.hyper {
                return Err("この部屋は通常ルールです。".into());
            }
            let option = game
                .hyper_options(player)
                .into_iter()
                .find(|option| option.role == role)
                .ok_or("その役はHyper化できません。")?;
            if role_cards(&game.active_captured(player), &option.role).is_empty() {
                return Err("Hyper化する札がありません。".into());
            }
            // Only the selected role is banked. Both capture piles lose their
            // roles and return to the stock; the opponent gets the first turn.
            // Existing stakes/contracts/HP persist, but a loss burns the stake.
            game.hyper_stake[player] += option.points;
            game.deck.append(&mut game.captured[player]);
            game.hyper_sealed[player].clear();
            game.hyper_contracts[player].push(option.contract.clone());
            game.checkpoint[player] = 0;
            game.clear_opponent_for_reset(player);
            // 盤面を仕切り直す。両手札・場札・山札を集めて配り直す。
            game.hyper_reset_board();
            if option.contract.id == "storm" && game.hyper_hp.is_none() {
                game.hyper_hp = Some([DUEL_HP; 2]);
                game.push_log("修羅場、両者HP18。取った枚数で攻撃、3連鎖から追加ダメージ！".into());
            }
            game.push_log(format!(
                "{}番手、{}を効果『{}』へHyper化。賭け金{}、取り札は没収。{}。盤面を仕切り直し。",
                player + 1,
                option.role,
                option.contract.name,
                option.points,
                option.contract.description,
            ));
            game.advance_turn();
            Ok(())
        })
    }

    pub fn hyper_state(&self, player: Option<usize>) -> Option<HyperState> {
        self.hyper.then(|| HyperState {
            contracts: self.hyper_contracts.clone(),
            stake: self.hyper_stake,
            bloom: self.hyper_bloom,
            chain: self.hyper_chain,
            sealed: self.hyper_sealed.clone(),
            options: player.map(|index| self.hyper_options(index)).unwrap_or_default(),
            multiplier: [self.hyper_multiplier(0), self.hyper_multiplier(1)],
            projected: [self.hyper_payout(0, 0), self.hyper_payout(1, 0)],
            hp: self.hyper_hp,
            hp_max: DUEL_HP,
            boosts: self.hyper_boosts,
        })
    }

    /// Performs exactly one phase's action. The AI inspects its own hand and
    /// public cards only, never the opponent's hand or the unexposed stock.
    pub fn cpu_action(&mut self) {
        let player = self.turn;
        match self.phase {
            Phase::Play => {
                let best = self.hands[player]
                    .iter()
                    .flat_map(|&card| {
                        let matches = self.matching(card);
                        if matches.len() == 2 {
                            matches
                                .into_iter()
                                .map(|target| (card, Some(target)))
                                .collect()
                        } else {
                            vec![(card, matches.first().copied())]
                        }
                    })
                    .max_by_key(|&(card, target)| self.move_value(player, card, target));
                if let Some((card, target)) = best {
                    let _ = self.play(player, card, target);
                }
            }
            Phase::DrawChoice => {
                if let Some(card) = self.drawn_card {
                    let best = self
                        .legal_targets()
                        .into_iter()
                        .max_by_key(|&target| self.move_value(player, card, Some(target)));
                    if let Some(target) = best {
                        let _ = self.choose(player, target);
                    }
                }
            }
            Phase::Decision => {
                if self.hyper && !self.can_cash_out(player) && self.hands.iter().all(Vec::is_empty) {
                    if let Some(option) = self.hyper_options(player).first() {
                        let _ = self.hyper(player, option.role.clone());
                    }
                    return;
                }
                if self.hyper {
                    let options = self.hyper_options(player);
                    // Hyper化は取り札を捨てて契約を取る賭け。捨てる分が賭け金に
                    // 見合う時だけ踏み切る。
                    let pile = total(&evaluate(&self.active_captured(player)));
                    if let Some(option) = options.iter().find(|option| {
                        option.points * 2 >= pile.saturating_sub(option.points)
                    })
                        && self.hyper_contracts[player].len() < 3
                        && self.hyper_payout(player, 0) < 55
                        && self.hyper_hp.is_none_or(|hp| hp[player] > 6)
                    {
                        let _ = self.hyper(player, option.role.clone());
                        return;
                    }
                }
                let points = total(&evaluate(&self.active_captured(player)));
                // Take a substantial win; chase a small one only while enough
                // hand cards remain to have a reasonable chance of improving.
                let keep_going = !self.can_cash_out(player)
                    || (points < 4 && self.hands[player].len() >= 3 && self.koikoi[1 - player] == 0);
                let _ = self.decision(player, keep_going);
            }
            Phase::RoundEnd | Phase::Finished => {}
        }
    }

    fn deal(&mut self) {
        self.events.clear();
        loop {
            self.deck = (0..48).collect();
            self.deck.shuffle(&mut self.rng);
            self.hands = [vec![], vec![]];
            self.field.clear();
            for _ in 0..8 {
                self.hands[0].push(self.deck.pop().unwrap());
                self.hands[1].push(self.deck.pop().unwrap());
                self.field.push(self.deck.pop().unwrap());
            }
            let mut counts = [0u8; 12];
            for &card in &self.field {
                counts[month(card)] += 1;
            }
            if !counts.contains(&4) {
                break;
            }
        }
        for hand in &mut self.hands {
            hand.sort_unstable();
        }
        self.captured = [vec![], vec![]];
        self.drawn_card = None;
        self.koikoi = [0; 2];
        self.checkpoint = [0; 2];
        self.hyper_contracts = [vec![], vec![]];
        self.hyper_stake = [0; 2];
        self.hyper_bloom = [0; 2];
        self.hyper_chain = [0; 2];
        self.hyper_sealed = [vec![], vec![]];
        self.board_revision = self.board_revision.saturating_add(1);
        self.hyper_hp = None;
        self.hyper_boosts = [0; 2];
        self.hyper_turn_captures = [0; 2];
        self.hyper_miss_used = [false; 2];
        self.hyper_captured = [0; 2];
        self.hyper_pending_draws = [0; 2];
        self.hyper_draws_used = [0; 2];
        self.hyper_beast_used = [0; 2];
        self.hyper_feast_used = [0; 2];
        self.hyper_hunt_used = [0; 2];
        self.hyper_ink_used = [0; 2];
        self.hyper_grass_used = [0; 2];
        self.hyper_overdrive_used = [0; 2];
        self.winner = None;
        self.round_points = 0;
        self.phase = Phase::Play;
        self.turn = self.dealer;
        self.push_log(format!(
            "第{}局、{}番手が親です。",
            self.round,
            self.dealer + 1
        ));
        self.check_opening_hands();
    }

    fn check_opening_hands(&mut self) {
        for player in [self.dealer, 1 - self.dealer] {
            if let Some(name) = opening_yaku(&self.hands[player]) {
                self.push_log(format!("{}番手、{}！", player + 1, name));
                self.settle(Some(player), 6);
                break;
            }
        }
    }

    fn require_turn(&self, player: usize, phase: Phase) -> Result<(), String> {
        if player > 1 {
            return Err("無効なプレイヤーです。".into());
        }
        if self.phase != phase {
            return Err("今はその操作を実行できません。".into());
        }
        if self.turn != player {
            return Err("相手の手番です。".into());
        }
        Ok(())
    }

    fn matching(&self, card: u8) -> Vec<u8> {
        let same_month = self.field
            .iter()
            .copied()
            .filter(|&other| month(card) == month(other))
            .collect::<Vec<_>>();
        if !same_month.is_empty() {
            return same_month;
        }
        // 詠唱 turns a ribbon into a one-shot cross-month link. Returning a
        // single target keeps the normal no-dialogue hand interaction intact.
        if self.hyper
            && RIBBONS.contains(&card)
            && self.has_hyper_contract(self.turn, "chant")
            && let Some(ribbon) = self.field.iter().copied().find(|other| RIBBONS.contains(other))
        {
            return vec![ribbon];
        }
        vec![]
    }

    fn has_hyper_contract(&self, player: usize, id: &str) -> bool {
        self.hyper_contracts[player].iter().any(|contract| contract.id == id)
    }

    fn active_captured(&self, player: usize) -> Vec<u8> {
        self.captured[player]
            .iter()
            .copied()
            .filter(|card| !self.hyper_sealed[player].contains(card))
            .collect()
    }

    fn validate_target(&self, matches: &[u8], target: Option<u8>) -> Result<(), String> {
        if let Some(target) = target
            && !matches.contains(&target)
        {
            return Err("同じ月の場札を選んでください。".into());
        }
        if matches.len() == 2 && target.is_none() {
            return Err("取る場札を1枚選んでください。".into());
        }
        Ok(())
    }

    fn capture_or_place(
        &mut self,
        player: usize,
        card: u8,
        matches: &[u8],
        target: Option<u8>,
    ) -> Vec<u8> {
        if matches.is_empty() {
            self.field.push(card);
            if self.hyper && self.has_hyper_contract(player, "night") && !self.hyper_miss_used[player] {
                self.hyper_miss_used[player] = true;
                self.add_hyper_boost(player, 2);
                self.reserve_hyper_draw(player);
            }
            return vec![];
        }
        let taken = if matches.len() == 3 {
            matches.to_vec()
        } else {
            vec![target.unwrap_or(matches[0])]
        };
        self.field.retain(|other| !taken.contains(other));
        self.captured[player].push(card);
        self.captured[player].extend(taken.iter());
        if self.hyper {
            self.hyper_captured[player] = self.hyper_captured[player].saturating_add(1);
            // CHAIN starts only after this player has activated a Hyper
            // contract. A Hyper room by itself is not an active chain state.
            if !self.hyper_contracts[player].is_empty() {
                self.hyper_chain[player] = self.hyper_chain[player].saturating_add(1);
                self.hyper_turn_captures[player] += 1;
            }
            let mut acquired = Vec::with_capacity(taken.len() + 1);
            acquired.push(card);
            acquired.extend(taken.iter().copied());
            self.queue_hyper_effects(player, &acquired);
            if let Some(hp) = &mut self.hyper_hp {
                let damage = acquired.len() as u8 + u8::from(self.hyper_chain[player] >= 3);
                hp[1 - player] = hp[1 - player].saturating_sub(damage);
            }
        }
        self.push_log(format!(
            "{}番手、{}月の札を{}枚獲得。",
            player + 1,
            month(card) + 1,
            taken.len() + 1
        ));
        taken
    }

    fn draw(&mut self) {
        if let Some(card) = self.deck.pop() {
            let matches = self.matching(card);
            if matches.len() == 2 {
                self.drawn_card = Some(card);
                self.phase = Phase::DrawChoice;
                self.push_event(self.turn, PublicGameEventSource::Draw, card, vec![], true);
                return;
            }
            let targets = self.capture_or_place(self.turn, card, &matches, None);
            self.push_event(self.turn, PublicGameEventSource::Draw, card, targets, false);
        }
        self.finish_draw_chain();
    }

    fn finish_draw_chain(&mut self) {
        if self.finish_hyper_duel() { return; }
        // A player without a contract gets one answer draw each turn once the
        // opponent has built a three-capture chain. Its budget cannot recurse.
        if self.hyper
            && self.hyper_draws_used[self.turn] < self.counter_draw_budget(self.turn)
            && self.hyper_pending_draws[self.turn] == 0
            && !self.deck.is_empty()
        {
            self.hyper_pending_draws[self.turn] = 1;
            self.push_log(format!("{}番手、反撃の追加めくり！", self.turn + 1));
        }
        if self.hyper
            && self.hyper_pending_draws[self.turn] > 0
            && !self.deck.is_empty()
        {
            self.hyper_pending_draws[self.turn] -= 1;
            self.hyper_draws_used[self.turn] = self.hyper_draws_used[self.turn].saturating_add(1);
            self.draw();
        } else {
            self.hyper_pending_draws[self.turn] = 0;
            self.finish_turn();
        }
    }

    fn add_hyper_boost(&mut self, player: usize, quarters: u8) {
        self.hyper_boosts[player] = self.hyper_boosts[player].saturating_add(quarters).min(12);
    }

    // Hundredths avoid client/server floating-point rounding disagreements.
    fn hyper_multiplier(&self, player: usize) -> u32 {
        let base = [100, 175, 250, 350][self.hyper_contracts[player].len().min(3)];
        let streak = u32::from(self.hyper_chain[player].min(12) / 2) * 25;
        (base + streak + u32::from(self.hyper_boosts[player]) * 25).min(800)
    }

    fn hyper_payout(&self, player: usize, minimum: u32) -> u32 {
        let roles = total(&evaluate(&self.active_captured(player))).max(minimum);
        ((roles + self.hyper_stake[player] + self.hyper_bloom[player])
            * self.hyper_multiplier(player)).div_ceil(100)
    }

    fn finish_hyper_duel(&mut self) -> bool {
        if let Some(hp) = self.hyper_hp
            && hp[1 - self.turn] == 0
        {
            self.hyper_pending_draws = [0; 2];
            self.push_log(format!("{}番手、K.O.！修羅場を制圧。", self.turn + 1));
            self.settle(Some(self.turn), self.hyper_payout(self.turn, 8));
            return true;
        }
        false
    }

    fn reserve_hyper_draw(&mut self, player: usize) -> bool {
        if self.deck.is_empty()
            || self.hyper_draws_used[player] + self.hyper_pending_draws[player] >= HYPER_DRAW_LIMIT
        { return false; }
        self.hyper_pending_draws[player] += 1;
        true
    }

    fn queue_hyper_effects(&mut self, player: usize, acquired: &[u8]) {
        if !self.hyper || self.hyper_contracts[player].is_empty() { return; }
        let animals = acquired.iter().any(|card| ANIMALS.contains(card));
        let ribbons = acquired.iter().any(|card| RIBBONS.contains(card));
        let bright_or_cup = acquired.iter().any(|card| BRIGHTS.contains(card) || *card == 32);
        let chaff = acquired.iter().any(|card| *card == 32
            || (!BRIGHTS.contains(card) && !ANIMALS.contains(card) && !RIBBONS.contains(card)));
        // Every contract gets a starter draw; specialised engines add to it.
        if self.hyper_turn_captures[player] == 1 { self.reserve_hyper_draw(player); }
        if animals && self.has_hyper_contract(player, "beast") && self.hyper_beast_used[player] < 3 {
            self.hyper_beast_used[player] += 1;
            self.reserve_hyper_draw(player);
        }
        if animals && self.has_hyper_contract(player, "hunt") && self.hyper_hunt_used[player] < 1 {
            self.hyper_hunt_used[player] += 1;
            self.add_hyper_boost(player, 1);
            self.reserve_hyper_draw(player);
        }
        if ribbons && self.has_hyper_contract(player, "ink") && self.hyper_ink_used[player] < 2 {
            self.hyper_ink_used[player] += 1;
            self.reserve_hyper_draw(player);
        }
        if bright_or_cup && self.has_hyper_contract(player, "feast") && self.hyper_feast_used[player] < 2 {
            self.hyper_feast_used[player] += 1;
            self.hyper_bloom[player] += 2;
            self.reserve_hyper_draw(player);
        }
        if chaff && self.has_hyper_contract(player, "grass") && self.hyper_grass_used[player] < 3 {
            self.hyper_grass_used[player] += 1;
            self.hyper_bloom[player] += 1;
            if self.hyper_grass_used[player] == 2 { self.reserve_hyper_draw(player); }
        }
        if self.has_hyper_contract(player, "seal") && self.hyper_turn_captures[player] <= 2 {
            self.add_hyper_boost(player, 1);
        }
        if self.hyper_chain[player] >= 3 && self.hyper_chain[player].is_multiple_of(3)
            && self.hyper_overdrive_used[player] < 2
        {
            self.hyper_overdrive_used[player] += 1;
            self.add_hyper_boost(player, 1);
            if self.reserve_hyper_draw(player) {
                self.push_log(format!("{}番手、{} CHAIN！追加めくり＆倍率上昇。", player + 1, self.hyper_chain[player]));
            }
        }
    }

    /// Atomic redeal: both piles were confiscated into the stock before this
    /// call. All 48 cards restart as 8 + 8 hands, 8 field and 24 stock.
    /// Smaller synthetic/research pools reserve at least a quarter for draws.
    fn hyper_reset_board(&mut self) {
        let mut pool = Vec::with_capacity(48);
        pool.append(&mut self.hands[0]);
        pool.append(&mut self.hands[1]);
        pool.append(&mut self.field);
        pool.append(&mut self.deck);
        if let Some(card) = self.drawn_card.take() { pool.push(card); }
        let deal_count = (pool.len() / 4).min(8);
        loop {
            pool.shuffle(&mut self.rng);
            let mut stock = pool.clone();
            let mut hands = [vec![], vec![]];
            let mut field = vec![];
            for _ in 0..deal_count {
                hands[0].push(stock.pop().unwrap());
                hands[1].push(stock.pop().unwrap());
                field.push(stock.pop().unwrap());
            }
            let mut counts = [0u8; 12];
            for &card in &field { counts[month(card)] += 1; }
            if !counts.contains(&4) {
                self.hands = hands;
                self.field = field;
                self.deck = stock;
                break;
            }
        }
        for hand in &mut self.hands { hand.sort_unstable(); }
        self.events.clear();
        self.board_revision += 1;
        self.hyper_chain = [0; 2];
        for player in 0..2 { self.reset_hyper_turn(player); }
        self.push_log(format!("再配布！双方の手札{}枚・場{}枚・山札{}枚。", deal_count, deal_count, self.deck.len()));
    }

    fn clear_opponent_for_reset(&mut self, player: usize) {
        let opponent = 1 - player;
        let keep: Vec<u8> = match self.reset_policy {
            ResetPolicy::All => vec![],
            #[cfg(test)]
            ResetPolicy::KeepOpponent => self.captured[opponent].clone(),
            #[cfg(test)]
            ResetPolicy::KeepBestRole => evaluate(&self.active_captured(opponent)).iter()
                .max_by_key(|role| role.points)
                .map(|role| role_cards(&self.active_captured(opponent), &role.name))
                .unwrap_or_default(),
        };
        for card in self.captured[opponent].drain(..) {
            if !keep.contains(&card) { self.deck.push(card); }
        }
        self.captured[opponent] = keep;
        self.hyper_sealed[opponent].clear();
        self.checkpoint[opponent] = total(&evaluate(&self.active_captured(opponent)));
    }

    fn reset_hyper_turn(&mut self, player: usize) {
        self.hyper_turn_captures[player] = 0;
        self.hyper_miss_used[player] = false;
        self.hyper_pending_draws[player] = 0;
        self.hyper_draws_used[player] = 0;
        self.hyper_beast_used[player] = 0;
        self.hyper_feast_used[player] = 0;
        self.hyper_hunt_used[player] = 0;
        self.hyper_ink_used[player] = 0;
        self.hyper_grass_used[player] = 0;
        self.hyper_overdrive_used[player] = 0;
    }

    fn finish_turn(&mut self) {
        if self.hyper && self.hyper_turn_captures[self.turn] == 0 {
            self.hyper_chain[self.turn] = 0;
        }
        let points = total(&evaluate(&self.active_captured(self.turn)));
        if points > self.checkpoint[self.turn] {
            self.phase = Phase::Decision;
            if !self.can_cash_out(self.turn) && self.exhausted() && self.hyper_options(self.turn).is_empty() {
                self.settle(None, 0);
                return;
            }
            self.push_log(format!("{}番手、役成立！ {}文。", self.turn + 1, points));
        } else {
            self.advance_turn();
        }
    }

    fn exhausted(&self) -> bool {
        self.hands.iter().all(Vec::is_empty)
    }

    fn advance_turn(&mut self) {
        if self.hyper {
            // The streak survives opponent turns; only a captureless own turn
            // breaks it. Per-turn effect budgets must not survive a turn.
            self.reset_hyper_turn(self.turn);
        }
        if self.exhausted() {
            // A previous koi-koi does not bank points: failure to improve before
            // both hands run out is a draw, including its previous yaku.
            self.settle(None, 0);
        } else {
            self.turn = 1 - self.turn;
            if self.hands[self.turn].is_empty() {
                self.turn = 1 - self.turn;
            }
            self.phase = Phase::Play;
        }
    }

    fn settle(&mut self, winner: Option<usize>, points: u32) {
        self.winner = winner;
        self.round_points = points;
        if let Some(player) = winner {
            self.scores[player] += points;
            self.push_log(format!("{}番手の勝ち、{}文！", player + 1, points));
        } else {
            self.push_log("流局。こいこい中の役は得点になりません。".into());
        }
        self.phase = if self.round >= self.rounds {
            Phase::Finished
        } else {
            Phase::RoundEnd
        };
    }

    fn move_value(&self, player: usize, card: u8, target: Option<u8>) -> i32 {
        let matches = self.matching(card);
        if matches.is_empty() {
            // Keep the more valuable cards in hand when a capture is impossible.
            return -card_value(card);
        }
        let mut potential = self.active_captured(player);
        potential.push(card);
        if matches.len() == 3 {
            potential.extend(&matches);
        } else if let Some(target) = target.or_else(|| matches.first().copied()) {
            potential.push(target);
        }
        let gain =
            total(&evaluate(&potential)) as i32 - total(&evaluate(&self.active_captured(player))) as i32;
        gain * 100 + potential.iter().map(|&c| card_value(c)).sum::<i32>()
            - self.captured[player]
                .iter()
                .map(|&c| card_value(c))
                .sum::<i32>()
    }

    fn push_log(&mut self, message: String) {
        self.log.push(message);
        if self.log.len() > 80 {
            self.log.remove(0);
        }
    }

    fn push_event(
        &mut self,
        player: usize,
        source: PublicGameEventSource,
        card_id: u8,
        target_ids: Vec<u8>,
        requires_choice: bool,
    ) {
        self.event_seq += 1;
        self.events.push(PublicGameEvent {
            id: self.event_seq,
            player,
            source,
            card_id,
            captured: !target_ids.is_empty(),
            target_ids,
            field: self.field.clone(),
            captured_cards: self.captured.clone(),
            deck_count: self.deck.len(),
            requires_choice,
            hyper: self.hyper.then(|| HyperBeat {
                chain: self.hyper_chain,
                bloom: self.hyper_bloom,
                multiplier: [self.hyper_multiplier(0), self.hyper_multiplier(1)],
                hp: self.hyper_hp,
                counter_draw: source != PublicGameEventSource::Hand
                    && self.counter_draw_budget(player) > 0
                    && self.hyper_draws_used[player] > 0,
            }),
        });
        if self.events.len() > 12 {
            self.events.remove(0);
        }
    }
}

fn hyper_contract_for_role(role: &str) -> Option<HyperContract> {
    let (id, name, source, points, description) = match role {
        "猪鹿蝶" => ("beast", "暴走", "猪鹿蝶", 5, "タネ取得で追加めくり（各手番3回まで）"),
        "赤短" => ("chant", "詠唱", "赤短", 5, "短冊が月を越えて場札に結びつく"),
        "青短" => ("seal", "倍喰い", "青短", 5, "札を取るたび倍率＋0.25（各手番2回まで）。成長は再配布後も残る"),
        "花見で一杯" => ("feast", "宴", "花見酒", 5, "光・盃の取得で追加めくり＆花力＋2（各手番2回まで）"),
        "月見で一杯" => ("night", "逆転月", "月見酒", 5, "各手番最初の空振りで追加めくり＆倍率＋0.5。失敗を燃料にする"),
        "三光" | "雨四光" | "四光" | "五光" => {
            ("storm", "修羅場", "光役", points_for_role(role), "双方HP18の殴り合い！取得枚数で攻撃、3連鎖から＋1。HP0でK.O.、役あがりも可能")
        }
        "タネ" => ("hunt", "追猟", "タネ", 1, "各手番最初のタネ取得で追加めくり＆倍率＋0.25"),
        "短冊" => ("ink", "連筆", "タン", 1, "短冊取得で追加めくり（各手番2回まで）"),
        "カス" => ("grass", "永久機関", "カス", 1, "カス取得で花力＋1（各手番3回まで）、2回目は追加めくり"),
        _ => return None,
    };
    Some(HyperContract {
        id: id.into(),
        name: name.into(),
        source: source.into(),
        points,
        description: description.into(),
    })
}

fn points_for_role(role: &str) -> u32 {
    match role {
        "五光" => 10,
        "四光" => 8,
        "雨四光" => 7,
        _ => 5,
    }
}

fn role_cards(captured: &[u8], role: &str) -> Vec<u8> {
    let set = match role {
        "五光" | "四光" | "雨四光" | "三光" => &BRIGHTS[..],
        "猪鹿蝶" => &[20, 24, 36][..],
        "赤短" => &[1, 5, 9][..],
        "青短" => &[21, 33, 37][..],
        "花見で一杯" => &[8, 32][..],
        "月見で一杯" => &[28, 32][..],
        "タネ" => &ANIMALS[..],
        "短冊" => &RIBBONS[..],
        "カス" => &[],
        _ => &[],
    };
    if role == "カス" {
        return captured
            .iter()
            .copied()
            .filter(|card| {
                *card == 32
                    || (!BRIGHTS.contains(card)
                        && !ANIMALS.contains(card)
                        && !RIBBONS.contains(card))
            })
            .collect();
    }
    captured
        .iter()
        .copied()
        .filter(|card| set.contains(card))
        .collect()
}

fn month(card: u8) -> usize {
    (card / 4) as usize
}

fn total(yaku: &[Yaku]) -> u32 {
    yaku.iter().map(|yaku| yaku.points).sum()
}

fn card_value(card: u8) -> i32 {
    if BRIGHTS.contains(&card) {
        12
    } else if card == 32 {
        14
    } else if ANIMALS.contains(&card) {
        7
    } else if RIBBONS.contains(&card) {
        5
    } else {
        1
    }
}

fn opening_yaku(hand: &[u8]) -> Option<&'static str> {
    let mut counts = [0u8; 12];
    for &card in hand {
        counts[month(card)] += 1;
    }
    if counts.contains(&4) {
        Some("手四")
    } else if counts.iter().filter(|&&count| count == 2).count() == 4 {
        Some("くっつき")
    } else {
        None
    }
}

fn evaluate(cards: &[u8]) -> Vec<Yaku> {
    let mut result = vec![];
    let mut add = |name: &str, points: u32| {
        result.push(Yaku {
            name: name.into(),
            points,
        })
    };
    let contains_all = |set: &[u8]| set.iter().all(|card| cards.contains(card));
    let brights = cards.iter().filter(|card| BRIGHTS.contains(card)).count();
    let rain = cards.contains(&40);
    match (brights, rain) {
        (5, _) => add("五光", 10),
        (4, false) => add("四光", 8),
        (4, true) => add("雨四光", 7),
        (3, false) => add("三光", 5),
        _ => {}
    }
    if contains_all(&[20, 24, 36]) {
        add("猪鹿蝶", 5);
    }
    if contains_all(&[1, 5, 9]) {
        add("赤短", 5);
    }
    if contains_all(&[21, 33, 37]) {
        add("青短", 5);
    }
    if contains_all(&[8, 32]) {
        add("花見で一杯", 5);
    }
    if contains_all(&[28, 32]) {
        add("月見で一杯", 5);
    }
    let animals = cards.iter().filter(|card| ANIMALS.contains(card)).count();
    let ribbons = cards.iter().filter(|card| RIBBONS.contains(card)).count();
    let chaff = cards
        .iter()
        .filter(|card| {
            **card == 32
                || (!BRIGHTS.contains(card) && !ANIMALS.contains(card) && !RIBBONS.contains(card))
        })
        .count();
    if animals >= 5 {
        add("タネ", (animals - 4) as u32);
    }
    if ribbons >= 5 {
        add("短冊", (ribbons - 4) as u32);
    }
    if chaff >= 10 {
        add("カス", (chaff - 9) as u32);
    }
    result
}

#[cfg(test)]
#[path = "hyper_simulation.rs"]
mod hyper_simulation;

#[cfg(test)]
#[path = "hyper_tests.rs"]
mod hyper_tests;

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Game {
        Game {
            rng: StdRng::seed_from_u64(42),
            reset_policy: ResetPolicy::All,
            hyper: false,
            rounds: 3,
            round: 1,
            dealer: 0,
            turn: 0,
            phase: Phase::Play,
            hands: [vec![], vec![]],
            captured: [vec![], vec![]],
            field: vec![],
            deck: vec![],
            drawn_card: None,
            koikoi: [0; 2],
            scores: [0; 2],
            winner: None,
            round_points: 0,
            hyper_contracts: [vec![], vec![]],
            hyper_stake: [0; 2],
            hyper_bloom: [0; 2],
            hyper_chain: [0; 2],
            hyper_sealed: [vec![], vec![]],
            board_revision: 0,
            hyper_hp: None,
            hyper_boosts: [0; 2],
            hyper_turn_captures: [0; 2],
            hyper_miss_used: [false; 2],
            hyper_pending_draws: [0; 2],
            hyper_draws_used: [0; 2],
            hyper_beast_used: [0; 2],
            hyper_feast_used: [0; 2],
            hyper_hunt_used: [0; 2],
            hyper_ink_used: [0; 2],
            hyper_grass_used: [0; 2],
            hyper_overdrive_used: [0; 2],
            log: vec![],
            events: vec![],
            event_seq: 0,
            checkpoint: [0; 2],
            hyper_captured: [0; 2],
            forfeited_winner: None,
            balance_variant: 3,
        }
    }

    fn assert_conservation(game: &Game) {
        let mut cards = game
            .hands
            .iter()
            .flatten()
            .chain(game.captured.iter().flatten())
            .chain(game.field.iter())
            .chain(game.deck.iter())
            .chain(game.drawn_card.iter())
            .copied()
            .collect::<Vec<_>>();
        cards.sort_unstable();
        assert_eq!(cards, (0..48).collect::<Vec<_>>());
    }

    #[test]
    fn movements_snapshot_hand_before_draw_and_only_expose_public_cards() {
        let mut game = fixture();
        game.set_event_sequence(20);
        game.hands = [vec![0, 24], vec![36, 44]];
        game.field = vec![1, 5, 8];
        game.deck = vec![40, 4];
        game.play(0, 0, None).unwrap();

        assert_eq!(game.events.len(), 2);
        assert_eq!(
            game.events[0],
            PublicGameEvent {
                hyper: None,
                id: 21,
                player: 0,
                source: PublicGameEventSource::Hand,
                card_id: 0,
                target_ids: vec![1],
                captured: true,
                field: vec![5, 8],
                captured_cards: [vec![0, 1], vec![]],
                deck_count: 2,
                requires_choice: false,
            }
        );
        assert_eq!(
            game.events[1],
            PublicGameEvent {
                hyper: None,
                id: 22,
                player: 0,
                source: PublicGameEventSource::Draw,
                card_id: 4,
                target_ids: vec![5],
                captured: true,
                field: vec![8],
                captured_cards: [vec![0, 1, 4, 5], vec![]],
                deck_count: 1,
                requires_choice: false,
            }
        );
        assert_eq!(game.turn, 1);
        for event in &game.events {
            let public_cards = std::iter::once(&event.card_id)
                .chain(&event.target_ids)
                .chain(&event.field)
                .chain(event.captured_cards.iter().flatten());
            assert!(
                public_cards
                    .into_iter()
                    .all(|card| ![24, 36, 44, 40].contains(card))
            );
        }
        let json = serde_json::to_value(&game.events[0]).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "id": 21, "player": 0, "source": "hand", "cardId": 0,
                "targetIds": [1], "captured": true, "field": [5, 8],
                "capturedCards": [[0, 1], []], "deckCount": 2, "requiresChoice": false,
            })
        );
    }

    #[test]
    fn draw_choice_reveal_and_capture_are_distinct_public_events() {
        let mut game = fixture();
        game.hands = [vec![4], vec![12]];
        game.field = vec![1, 2, 8];
        game.deck = vec![40, 0];
        game.play(0, 4, None).unwrap();
        assert_eq!(game.events.len(), 2);
        let reveal = game.events[1].clone();
        assert_eq!(reveal.source, PublicGameEventSource::Draw);
        assert_eq!(reveal.card_id, 0);
        assert!(reveal.requires_choice);
        assert!(!reveal.captured);
        assert!(reveal.target_ids.is_empty());
        assert_eq!(reveal.field, vec![1, 2, 8, 4]);
        assert!(reveal.captured_cards.iter().all(Vec::is_empty));
        assert_eq!(reveal.deck_count, 1);

        let before = game.events.clone();
        let sequence = game.event_sequence();
        assert!(game.choose(0, 8).is_err());
        assert!(game.choose(1, 1).is_err());
        assert_eq!(game.events, before);
        assert_eq!(game.event_sequence(), sequence);
        game.choose(0, 2).unwrap();
        assert_eq!(
            game.events[2],
            PublicGameEvent {
                hyper: None,
                id: 3,
                player: 0,
                source: PublicGameEventSource::Choice,
                card_id: 0,
                target_ids: vec![2],
                captured: true,
                field: vec![1, 8, 4],
                captured_cards: [vec![0, 2], vec![]],
                deck_count: 1,
                requires_choice: false,
            }
        );
        assert_eq!(game.events[1], reveal);
    }

    #[test]
    fn events_keep_latest_twelve_and_empty_deck_has_no_draw_movement() {
        let mut game = fixture();
        game.hands = [
            vec![0, 4, 8, 12, 16, 20, 24],
            vec![28, 32, 36, 40, 44, 1, 5],
        ];
        while game.phase == Phase::Play {
            game.cpu_action();
        }
        assert_eq!(game.phase, Phase::RoundEnd);
        assert_eq!(game.event_sequence(), 14);
        assert_eq!(game.events.len(), 12);
        assert_eq!(
            game.events.iter().map(|event| event.id).collect::<Vec<_>>(),
            (3..=14).collect::<Vec<_>>()
        );
        assert!(
            game.events
                .iter()
                .all(|event| event.source == PublicGameEventSource::Hand)
        );
    }

    #[test]
    fn next_round_clears_events_but_preserves_seeded_sequence() {
        let mut game = fixture();
        game.set_event_sequence(100);
        game.set_event_sequence(20);
        assert_eq!(game.event_sequence(), 100);
        game.hands = [vec![0], vec![4]];
        game.play(0, 0, None).unwrap();
        assert_eq!(game.event_sequence(), 101);
        assert_eq!(game.events.len(), 1);
        game.settle(None, 0);
        game.next_round().unwrap();
        assert!(game.events.is_empty());
        assert_eq!(game.event_sequence(), 101);

        // Replace the random deal to keep this sequence test independent of
        // opening-hand yaku and the legal moves in the shuffled hand.
        game.phase = Phase::Play;
        game.hands = [vec![0], vec![4]];
        game.field.clear();
        game.deck.clear();
        let player = game.turn;
        game.play(player, game.hands[player][0], None).unwrap();
        assert_eq!(game.events[0].id, 102);
    }

    #[test]
    fn hyper_contract_trades_the_whole_pile_for_stake() {
        let mut game = fixture();
        game.hyper = true;
        game.phase = Phase::Decision;
        game.turn = 0;
        game.hands = [vec![4], vec![12]];
        game.captured[0] = vec![20, 24, 36, 0, 8, 28];
        game.deck = vec![1, 2, 3];
        let options = game.hyper_options(0);
        assert!(options.iter().any(|option| option.role == "猪鹿蝶"));
        game.hyper(0, "猪鹿蝶".into()).unwrap();
        // The named yaku becomes stake and the rest of the pile is discarded,
        // so the stacked 三光 goes with it and cannot restack either.
        assert_eq!(game.hyper_stake[0], 5);
        assert!(game.captured[0].is_empty());
        assert_eq!(game.checkpoint[0], 0);
        assert_eq!(game.hyper_contracts[0][0].id, "beast");
        // Eleven available cards, including the confiscated pile. Keep a stock.
        assert_eq!(game.hands[0].len(), 2);
        assert_eq!(game.hands[1].len(), 2);
        assert_eq!(game.field.len(), 2);
        assert_eq!(game.deck.len(), 5);
        assert_eq!(game.phase, Phase::Play);
        assert_eq!(game.turn, 1);
        // An empty pile has nothing left to convert.
        game.phase = Phase::Decision;
        game.turn = 0;
        assert!(game.hyper_options(0).is_empty());
    }

    #[test]
    fn chain_is_scoped_to_hyper_rooms() {
        let mut normal = fixture();
        normal.hands = [vec![0], vec![]];
        normal.field = vec![1];
        normal.play(0, 0, None).unwrap();
        assert_eq!(normal.hyper_chain, [0, 0]);

        let mut hyper = fixture();
        hyper.hyper = true;
        hyper.hands = [vec![0], vec![]];
        hyper.field = vec![1];
        hyper.captured[0] = vec![20, 24, 36];
        let hyper_matches = hyper.matching(0);
        hyper.capture_or_place(0, 0, &hyper_matches, None);
        assert_eq!(hyper.hyper_chain, [0, 0]);

        let mut contracted = fixture();
        contracted.hyper = true;
        contracted.hyper_contracts[0].push(hyper_contract_for_role("猪鹿蝶").unwrap());
        contracted.hands = [vec![0], vec![]];
        contracted.field = vec![1];
        let contracted_matches = contracted.matching(0);
        contracted.capture_or_place(0, 0, &contracted_matches, None);
        assert_eq!(contracted.hyper_chain, [1, 0]);
    }

    #[test]
    fn storm_contract_starts_hp_duel_and_reserves_stock_after_reset() {
        let mut game = fixture();
        game.hyper = true;
        game.phase = Phase::Decision;
        game.turn = 0;
        game.hands = [vec![4], vec![12]];
        game.captured[0] = vec![0, 8, 28];
        game.field = vec![40, 41];
        game.deck = vec![
            1, 2, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 17, 18, 19, 21, 22, 23, 25, 26,
        ];
        game.hyper(0, "三光".into()).unwrap();
        assert_eq!(game.hands[0].len(), 6);
        assert_eq!(game.hands[1].len(), 6);
        assert_eq!(game.field.len(), 6);
        assert_eq!(game.deck.len(), 9);
        assert_eq!(game.hyper_hp, Some([DUEL_HP; 2]));
        assert!(game.hyper_contracts[0].iter().any(|contract| contract.id == "storm"));
        assert_eq!(game.hyper_stake[0], 5);
        assert!(game.captured[0].is_empty());
    }

    #[test]
    fn beast_contract_reserves_one_additional_draw_inside_the_existing_turn() {
        let mut game = fixture();
        game.hyper = true;
        game.hands = [vec![20], vec![4]];
        game.field = vec![21, 1];
        game.deck = vec![9, 5];
        game.hyper_contracts[0].push(hyper_contract_for_role("猪鹿蝶").unwrap());
        game.play(0, 20, None).unwrap();
        assert_eq!(game.events.len(), 3);
        assert_eq!(game.deck.len(), 0);
        assert!(game.field.contains(&5));
        assert!(game.field.contains(&9));
        assert_eq!(game.turn, 1);
    }

    #[test]
    fn hyper_loss_costs_the_hyper_side_its_stake_but_moves_no_points() {
        let mut game = fixture();
        game.hyper = true;
        game.phase = Phase::Decision;
        game.turn = 0;
        game.hyper_contracts[1].push(hyper_contract_for_role("猪鹿蝶").unwrap());
        game.hyper_stake[1] = 5;
        game.captured[0] = vec![0, 8, 28];
        game.captured[1] = vec![20, 24, 36];
        game.decision(0, false).unwrap();
        // Losing with a contract burns the stake and pays nothing to the
        // opponent, whose pile is left exactly as it was.
        assert_eq!(game.captured[1], vec![20, 24, 36]);
        assert_eq!(game.captured[0], vec![0, 8, 28]);
        assert_eq!(game.scores[0], 5);
        assert_eq!(game.winner, Some(0));
    }

    #[test]
    fn hyper_stake_is_paid_out_when_the_contract_holder_wins() {
        let mut game = fixture();
        game.hyper = true;
        game.phase = Phase::Decision;
        game.turn = 0;
        game.hyper_contracts[0].push(hyper_contract_for_role("猪鹿蝶").unwrap());
        game.hyper_stake[0] = 5;
        game.captured[0] = vec![1, 5, 9];
        game.decision(0, false).unwrap();
        // (5 points of 赤短 + 5 stake) x 1.8 for a single contract.
        assert_eq!(game.scores[0], 18);
    }

    #[test]
    fn hyper_chaff_conversion_clears_the_pile_so_chaff_cannot_restack() {
        let mut game = fixture();
        game.hyper = true;
        game.phase = Phase::Decision;
        game.turn = 0;
        game.captured[0] = vec![2, 3, 6, 7, 10, 11, 14, 15, 18, 19, 22];
        assert!(
            game.hyper_options(0)
                .iter()
                .any(|option| option.role == "カス")
        );
        game.hyper(0, "カス".into()).unwrap();
        // Eleven chaff is worth two points, and every chaff card is gone, so a
        // fresh カス can only ever come from newly captured cards.
        assert_eq!(game.hyper_stake[0], 2);
        assert!(game.captured[0].is_empty());
    }

    #[test]
    fn hyper_cpu_matches_terminate_and_keep_contracts_bounded() {
        for _ in 0..20 {
            let mut game = Game::new_hyper(3);
            let mut steps = 0;
            while game.phase != Phase::Finished {
                if game.phase == Phase::RoundEnd {
                    game.next_round().unwrap();
                } else {
                    game.cpu_action();
                }
                steps += 1;
                assert!(steps < 240, "hyper game stalled: {game:?}");
                assert!(game.hyper_contracts.iter().all(|contracts| contracts.len() <= 3));
            }
        }
    }

    #[test]
    fn full_cpu_matches_conserve_every_card_and_terminate() {
        for _ in 0..80 {
            let mut game = Game::new(3);
            let mut steps = 0;
            while game.phase != Phase::Finished {
                assert_conservation(&game);
                if game.phase == Phase::RoundEnd {
                    game.next_round().unwrap();
                } else {
                    game.cpu_action();
                }
                steps += 1;
                assert!(steps < 180, "game stalled: {game:?}");
            }
            assert_conservation(&game);
            assert_eq!(game.round, 3);
        }
    }

    #[test]
    fn invalid_actions_leave_state_unchanged() {
        let mut game = fixture();
        game.set_event_sequence(41);
        game.hands = [vec![0], vec![4]];
        game.field = vec![1, 2, 5];
        for (player, card, target) in [
            (2, 0, Some(1)),
            (1, 4, Some(5)),
            (0, 40, None),
            (0, 0, None),
            (0, 0, Some(5)),
        ] {
            let before = format!("{game:?}");
            assert!(game.play(player, card, target).is_err());
            assert_eq!(format!("{game:?}"), before);
        }
        let before = format!("{game:?}");
        assert!(game.choose(0, 1).is_err());
        assert!(game.decision(0, false).is_err());
        assert!(game.next_round().is_err());
        assert!(game.forfeit(9).is_err());
        assert_eq!(format!("{game:?}"), before);
    }

    #[test]
    fn captures_zero_one_two_or_three_matching_cards() {
        for count in 0..=3 {
            let mut game = fixture();
            game.hands = [vec![0], vec![4]];
            game.field = (1..=count).collect();
            let target = if count == 2 { Some(2) } else { None };
            game.play(0, 0, target).unwrap();
            assert_eq!(
                game.captured[0].len(),
                match count {
                    0 => 0,
                    3 => 4,
                    _ => 2,
                }
            );
            assert_eq!(
                game.field.len(),
                match count {
                    0 | 2 => 1,
                    _ => 0,
                }
            );
            if count == 2 {
                assert_eq!(game.field, vec![1]);
            }
            assert_eq!(game.events.len(), 1);
            assert_eq!(game.events[0].captured, count > 0);
            assert_eq!(
                game.events[0].target_ids.len(),
                if count == 3 {
                    3
                } else {
                    usize::from(count > 0)
                }
            );
            if count == 3 {
                assert_eq!(game.events[0].target_ids, vec![1, 2, 3]);
            }
        }
    }

    #[test]
    fn drawn_card_selection_is_validated_and_conserved() {
        let mut game = fixture();
        game.hands = [vec![4], vec![12]];
        game.field = vec![1, 2, 8];
        game.deck = vec![0];
        game.play(0, 4, None).unwrap();
        assert_eq!(game.phase, Phase::DrawChoice);
        assert_eq!(game.legal_targets(), vec![1, 2]);
        assert_eq!(game.drawn_card, Some(0));
        let before = format!("{game:?}");
        assert!(game.choose(0, 8).is_err());
        assert!(game.choose(1, 1).is_err());
        assert_eq!(format!("{game:?}"), before);
        game.choose(0, 2).unwrap();
        assert_eq!(game.captured[0], vec![0, 2]);
        assert_eq!(game.drawn_card, None);
        assert_eq!(game.turn, 1);
    }

    #[test]
    fn draw_resolves_zero_one_or_three_matches_automatically() {
        for count in [0, 1, 3] {
            let mut game = fixture();
            game.hands = [vec![4], vec![12]];
            game.field = (1..=count).collect();
            game.deck = vec![0];
            game.play(0, 4, None).unwrap();
            assert_eq!(game.phase, Phase::Play);
            assert_eq!(game.drawn_card, None);
            assert_eq!(
                game.captured[0].len(),
                match count {
                    0 => 0,
                    1 => 2,
                    _ => 4,
                }
            );
            assert!(game.field.contains(&4));
        }
    }

    #[test]
    fn hand_yaku_waits_until_drawn_capture_is_resolved() {
        let mut game = fixture();
        game.hands = [vec![8], vec![12]];
        game.captured[0] = vec![32];
        game.field = vec![9, 1, 2];
        game.deck = vec![0];
        game.play(0, 8, None).unwrap();
        assert_eq!(game.phase, Phase::DrawChoice);
        assert_eq!(total(&game.yaku()[0]), 5);
        assert!(game.decision(0, false).is_err());
        game.choose(0, 1).unwrap();
        assert_eq!(game.phase, Phase::Decision);
        game.decision(0, false).unwrap();
        assert_eq!(game.scores, [5, 0]);
    }

    #[test]
    fn evaluates_exclusive_brights_and_all_combinations() {
        for (cards, expected) in [
            (vec![0, 8, 40], None),
            (vec![0, 8, 28], Some(("三光", 5))),
            (vec![0, 8, 28, 40], Some(("雨四光", 7))),
            (vec![0, 8, 28, 44], Some(("四光", 8))),
            (vec![0, 8, 28, 40, 44], Some(("五光", 10))),
        ] {
            let yaku = evaluate(&cards);
            assert_eq!(
                yaku.first().map(|yaku| (yaku.name.as_str(), yaku.points)),
                expected
            );
            assert!(yaku.len() <= 1);
        }
        for (cards, name) in [
            (vec![20, 24, 36], "猪鹿蝶"),
            (vec![1, 5, 9], "赤短"),
            (vec![21, 33, 37], "青短"),
            (vec![8, 32], "花見で一杯"),
            (vec![28, 32], "月見で一杯"),
        ] {
            assert!(
                evaluate(&cards)
                    .iter()
                    .any(|yaku| yaku.name == name && yaku.points == 5)
            );
        }
    }

    #[test]
    fn sake_counts_as_both_animal_and_chaff_and_geese_are_animal() {
        let cards = vec![4, 12, 16, 29, 32, 2, 3, 6, 7, 10, 11, 14, 15, 18];
        let yaku = evaluate(&cards);
        assert!(yaku.contains(&Yaku {
            name: "タネ".into(),
            points: 1
        }));
        assert!(yaku.contains(&Yaku {
            name: "カス".into(),
            points: 1
        }));
    }

    #[test]
    fn koi_koi_requires_a_new_or_increased_yaku() {
        let mut game = fixture();
        game.hands = [vec![4, 12, 16], vec![20, 24]];
        game.captured[0] = vec![2, 3, 6, 7, 10, 11, 14, 15, 18, 19];
        game.finish_turn();
        assert_eq!(game.phase, Phase::Decision);
        game.decision(0, true).unwrap();
        assert_eq!(game.checkpoint[0], 1);
        assert_eq!(game.koikoi[0], 1);
        game.turn = 0;
        game.finish_turn();
        assert_eq!(game.phase, Phase::Play);
        game.turn = 0;
        game.captured[0].push(22);
        game.finish_turn();
        assert_eq!(game.phase, Phase::Decision);
        game.decision(0, false).unwrap();
        assert_eq!(game.round_points, 2);
    }

    #[test]
    fn bonuses_are_for_seven_points_and_opponent_koi_koi_only() {
        for (opponent_koi, own_koi, expected) in [(0, 0, 14), (1, 0, 28), (0, 1, 14), (2, 3, 28)] {
            let mut game = fixture();
            game.captured[0] = vec![0, 8, 28, 40]; // rain four: 7
            game.phase = Phase::Decision;
            game.koikoi = [own_koi, opponent_koi];
            game.decision(0, false).unwrap();
            assert_eq!(game.scores, [expected, 0]);
        }
    }

    #[test]
    fn exhaustion_forfeits_old_yaku_but_allows_new_last_turn_yaku() {
        let mut game = fixture();
        game.captured[0] = vec![8, 32];
        game.checkpoint[0] = 5;
        game.koikoi[0] = 1;
        game.finish_turn();
        assert_eq!(game.phase, Phase::RoundEnd);
        assert_eq!(game.scores, [0, 0]);
        assert_eq!(game.winner, None);

        let mut game = fixture();
        game.captured[0] = vec![8, 32];
        game.finish_turn();
        assert_eq!(game.phase, Phase::Decision);
        let before = format!("{game:?}");
        assert!(game.decision(0, true).is_err());
        assert_eq!(format!("{game:?}"), before);
        game.decision(0, false).unwrap();
        assert_eq!(game.scores, [5, 0]);
    }

    #[test]
    fn opening_special_hands_score_six_with_dealer_priority() {
        assert_eq!(opening_yaku(&[0, 1, 2, 3, 4, 8, 12, 16]), Some("手四"));
        assert_eq!(opening_yaku(&[0, 1, 4, 5, 8, 9, 12, 13]), Some("くっつき"));
        let mut game = fixture();
        game.dealer = 1;
        game.hands = [
            vec![0, 1, 2, 3, 4, 8, 12, 16],
            vec![20, 21, 24, 25, 28, 29, 32, 33],
        ];
        game.check_opening_hands();
        assert_eq!(game.winner, Some(1));
        assert_eq!(game.scores, [0, 6]);
    }

    #[test]
    fn new_round_resets_local_state_and_winner_becomes_dealer() {
        let mut game = fixture();
        game.koikoi = [2, 1];
        game.checkpoint = [5, 3];
        game.settle(Some(1), 7);
        game.next_round().unwrap();
        assert_eq!(game.round, 2);
        assert_eq!(game.dealer, 1);
        assert_eq!(game.turn, 1);
        assert_eq!(game.koikoi, [0, 0]);
        assert_eq!(game.checkpoint, [0, 0]);
        assert!(game.scores[1] >= 7); // An opening special hand can also score.
        assert_conservation(&game);
    }

    #[test]
    fn opening_table_never_contains_all_four_of_a_month() {
        for _ in 0..300 {
            let game = Game::new(1);
            let mut counts = [0; 12];
            for &card in &game.field {
                counts[month(card)] += 1;
            }
            assert!(!counts.contains(&4));
            assert_conservation(&game);
        }
    }

    #[test]
    fn drawn_round_switches_dealer() {
        let mut game = fixture();
        game.settle(None, 0);
        game.next_round().unwrap();
        assert_eq!(game.dealer, 1);
        assert_eq!(game.turn, 1);
    }

    #[test]
    fn match_result_and_resignation_are_distinct_from_last_round_winner() {
        let mut game = fixture();
        game.round = 3;
        game.scores = [20, 0];
        game.settle(Some(1), 5);
        assert_eq!(game.winner, Some(1));
        assert_eq!(game.match_winner(), Some(0));
        assert!(game.next_round().is_err());

        let mut game = fixture();
        game.scores = [100, 0];
        game.forfeit(0).unwrap();
        assert_eq!(game.phase, Phase::Finished);
        assert_eq!(game.match_winner(), Some(1));
        assert_eq!(game.round_points, 0);
    }
}
