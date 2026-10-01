use super::*;

fn blank() -> Game {
    let mut game = Game::with_rng(3, true, StdRng::seed_from_u64(17));
    game.hands = [vec![], vec![]];
    game.captured = [vec![], vec![]];
    game.field.clear();
    game.deck.clear();
    game.phase = Phase::Play;
    game
}

fn contract(game: &mut Game, player: usize, role: &str) {
    game.hyper_contracts[player].push(hyper_contract_for_role(role).unwrap());
    if role == "雨四光" { game.hyper_trap_choices[player] = vec![TrapKind::Levy, TrapKind::Reveal]; }
}

#[test]
fn conversion_is_atomic_even_on_last_card_and_preserves_exactly_48_cards() {
    for seed in 0..300 {
        let mut game = Game::with_rng(3, true, StdRng::seed_from_u64(seed));
        game.hands = [vec![], vec![]];
        game.field.clear();
        game.captured = [vec![20, 24, 36, 0, 8, 28], vec![1, 5, 9, 2, 3]];
        game.deck = (0..48).filter(|c| !game.captured.iter().flatten().any(|x| x == c)).collect();
        game.phase = Phase::Decision;
        game.checkpoint = [0, 5];
        game.hyper_hp = Some([7, 9]);
        game.hyper_boosts = [2, 3];
        game.set_event_sequence(100);
        game.push_event(0, PublicGameEventSource::Hand, 20, vec![21], false);
        let revision = game.board_revision;
        game.hyper(0, "猪鹿蝶".into()).unwrap();
        assert_eq!(game.hyper_stake, [5, 0]);
        assert!(game.captured.iter().all(Vec::is_empty));
        assert_eq!(game.checkpoint, [0, 0]);
        assert_eq!(game.hands.each_ref().map(Vec::len), [8, 8]);
        assert_eq!(game.field.len(), 8);
        assert_eq!(game.deck.len(), 24);
        assert_eq!(game.turn, 1);
        assert_eq!(game.phase, Phase::Play);
        assert_eq!(game.board_revision, revision + 1);
        assert!(game.events.is_empty());
        assert_eq!(game.event_sequence(), 101);
        assert_eq!(game.hyper_hp, Some([7, 9]));
        assert_eq!(game.hyper_boosts, [2, 3]);
        assert!(game.yaku().iter().all(Vec::is_empty));
        let mut cards: Vec<_> = game.hands.iter().flatten().chain(&game.field).chain(&game.deck).copied().collect();
        cards.sort_unstable();
        assert_eq!(cards, (0..48).collect::<Vec<_>>());
        let mut counts = [0; 12];
        for &card in &game.field { counts[month(card)] += 1; }
        assert!(!counts.contains(&4));
        let before = format!("{game:?}");
        assert!(game.hyper(0, "猪鹿蝶".into()).is_err());
        assert_eq!(before, format!("{game:?}"));
    }
}

#[test]
fn chain_survives_opponent_turn_but_breaks_on_a_captureless_own_turn() {
    let mut game = blank();
    contract(&mut game, 0, "猪鹿蝶");
    game.hands = [vec![0, 8], vec![12, 16]];
    game.field = vec![1];
    game.play(0, 0, None).unwrap();
    assert_eq!(game.hyper_chain[0], 1);
    game.play(1, 12, None).unwrap();
    assert_eq!(game.hyper_chain[0], 1);
    game.play(0, 8, None).unwrap();
    assert_eq!(game.hyper_chain[0], 0);
}

#[test]
fn contracted_player_needs_combined_base_points_above_cost_and_a_post_contract_koi() {
    let mut game = blank();
    contract(&mut game, 0, "花見で一杯"); // 5 points
    contract(&mut game, 0, "タネ"); // Costs do not add up; the largest is 5.
    game.captured[0] = vec![4, 12, 16, 20, 24]; // タネ 1 point
    game.phase = Phase::Decision;
    assert_eq!(game.cashout_minimum(0), 5);
    assert!(!game.can_cash_out(0));
    assert!(game.decision(0, false).is_err());
    assert_eq!(game.phase, Phase::Decision);
    game.hands = [vec![0], vec![8]];
    game.decision(0, true).unwrap();

    let mut opponent = blank();
    contract(&mut opponent, 0, "花見で一杯");
    opponent.captured[1] = vec![4, 12, 16, 20, 24];
    opponent.turn = 1;
    opponent.phase = Phase::Decision;
    assert!(opponent.can_cash_out(1));
    opponent.decision(1, false).unwrap();
    assert_eq!(opponent.winner, Some(1));

    let mut equal = blank();
    contract(&mut equal, 0, "花見で一杯");
    equal.captured[0] = vec![8, 32]; // Exactly 5 base points.
    equal.hyper_boosts[0] = 12;
    equal.koikoi[0] = 1;
    equal.phase = Phase::Decision;
    assert!(!equal.can_cash_out(0));

    let mut met = blank();
    contract(&mut met, 0, "花見で一杯");
    contract(&mut met, 0, "青短");
    met.captured[0] = vec![8, 32, 1, 5, 9]; // Two 5-point roles combine to clear the cost.
    met.hyper_boosts[0] = 10; // Multiplier is irrelevant to the threshold.
    met.phase = Phase::Decision;
    assert_eq!(met.cashout_minimum(0), 5);
    assert!(!met.can_cash_out(0));
    assert!(met.decision(0, false).unwrap_err().contains("最後の契約後にこいこい"));
    met.hyper_cashout_koi_ready[0] = true;
    assert!(met.can_cash_out(0));
    met.decision(0, false).unwrap();
    assert_eq!(met.winner, Some(0));
}

#[test]
fn pre_contract_koi_does_not_unlock_cashout_and_recontracting_remains_available() {
    let mut first = blank();
    first.koikoi[0] = 1;
    first.captured[0] = vec![8, 32];
    first.phase = Phase::Decision;
    first.hyper(0, "花見で一杯".into()).unwrap();
    assert_eq!(first.koikoi[0], 1);
    assert!(!first.cashout_koi_ready(0));
    assert!(!first.hyper_state(Some(0)).unwrap().cashout_koi_ready[0]);

    let mut game = blank();
    game.koikoi[0] = 1;
    contract(&mut game, 0, "花見で一杯");
    game.captured[0] = vec![8, 32, 1, 5, 9]; // 10 base points
    game.phase = Phase::Decision;
    assert!(!game.can_cash_out(0));
    assert!(game.hyper_options(0).iter().any(|option| option.role == "赤短"));
    game.hyper_cashout_koi_ready[0] = true;
    game.hyper(0, "赤短".into()).unwrap();
    assert_eq!(game.hyper_contracts[0].len(), 2);
    assert!(!game.cashout_koi_ready(0));
    game.turn = 0;
    game.captured[0] = vec![8, 32];
    game.phase = Phase::Decision;
    game.decision(0, true).unwrap();
    assert!(game.cashout_koi_ready(0));
}

#[test]
fn defender_draws_once_after_opponent_reaches_three_chain() {
    let mut game = blank();
    contract(&mut game, 1, "猪鹿蝶");
    game.hyper_chain[1] = 3;
    game.hands = [vec![0], vec![8]];
    game.field = vec![1, 12];
    game.deck = vec![13, 4];
    game.play(0, 0, None).unwrap();
    assert!(game.deck.is_empty());
    assert_eq!(game.hyper_draws_used[0], 0); // reset at end of turn
    assert!(game.captured[0].contains(&13));
    assert!(!game.events[1].hyper.as_ref().unwrap().counter_draw);
    assert!(game.events[2].hyper.as_ref().unwrap().counter_draw);
    assert_eq!(serde_json::to_value(&game.events[2]).unwrap()["hyper"]["counterDraw"], true);
    assert!(game.log.iter().any(|entry| entry.contains("反撃の追加めくり")));

    let mut before_chain = blank();
    contract(&mut before_chain, 1, "猪鹿蝶");
    before_chain.hyper_chain[1] = 2;
    before_chain.hands = [vec![0], vec![8]];
    before_chain.field = vec![1, 12];
    before_chain.deck = vec![13, 4];
    before_chain.play(0, 0, None).unwrap();
    assert_eq!(before_chain.deck, vec![13]);

    let mut choice = blank();
    contract(&mut choice, 1, "猪鹿蝶");
    choice.hyper_chain[1] = 3;
    choice.hands = [vec![0], vec![8]];
    choice.field = vec![1, 12, 14];
    choice.deck = vec![13, 4];
    choice.play(0, 0, None).unwrap();
    assert_eq!(choice.phase, Phase::DrawChoice);
    assert!(choice.events.last().unwrap().hyper.as_ref().unwrap().counter_draw);
    choice.choose(0, 12).unwrap();
    assert!(choice.events.last().unwrap().hyper.as_ref().unwrap().counter_draw);
}

#[test]
fn exhausted_below_threshold_can_recontract_or_draw() {
    let mut game = blank();
    contract(&mut game, 0, "花見で一杯");
    game.captured[0] = vec![4, 12, 16, 20, 24];
    game.hands = [vec![0], vec![]];
    game.field = vec![1];
    game.play(0, 0, None).unwrap();
    assert_eq!(game.phase, Phase::Decision);
    assert!(!game.can_cash_out(0));
    assert!(game.hyper_options(0).iter().any(|option| option.role == "タネ"));
    game.hyper(0, "タネ".into()).unwrap();
    assert_eq!(game.phase, Phase::Play);

    let mut no_option = blank();
    contract(&mut no_option, 0, "花見で一杯");
    contract(&mut no_option, 0, "タネ");
    contract(&mut no_option, 0, "青短");
    no_option.captured[0] = vec![4, 12, 16, 20, 24];
    no_option.hands = [vec![0], vec![]];
    no_option.field = vec![1];
    no_option.play(0, 0, None).unwrap();
    assert_eq!(no_option.phase, Phase::RoundEnd);
    assert_eq!(no_option.winner, None);
}

#[test]
fn every_engine_respects_global_extra_draw_budget() {
    let mut game = blank();
    for role in ["猪鹿蝶", "花見で一杯", "カス"] { contract(&mut game, 0, role); }
    game.deck = (0..48).collect();
    for n in 1..=12 {
        game.hyper_turn_captures[0] = n;
        game.hyper_chain[0] = n;
        game.queue_hyper_effects(0, &[32, 0, 20, 2]);
        assert!(game.hyper_pending_draws[0] + game.hyper_draws_used[0] <= HYPER_DRAW_LIMIT);
    }
    assert_eq!(game.hyper_pending_draws[0], HYPER_DRAW_LIMIT);
    assert_eq!(game.hyper_bloom, [9, 3]); // two feasts + three chaff cards; beast gifts three
}

#[test]
fn hp_knockout_stops_before_drawing_and_pays_server_projection() {
    let mut game = blank();
    game.hands = [vec![0], vec![8]];
    game.field = vec![1];
    game.deck = vec![12];
    contract(&mut game, 0, "三光");
    game.hyper_hp = Some([18, 2]);
    game.hyper_stake[0] = 5;
    game.play(0, 0, None).unwrap();
    assert_eq!(game.hyper_hp, Some([18, 0]));
    assert_eq!(game.winner, Some(0));
    assert_eq!(game.phase, Phase::RoundEnd);
    assert_eq!(game.round_points, game.hyper_payout(0, 8));
    assert_eq!(game.deck, vec![12]);
    assert_eq!(game.events.len(), 1);
    assert_eq!(game.events[0].hyper.as_ref().unwrap().hp, Some([18, 0]));
    assert_eq!(game.hyper_pending_draws, [0, 0]);
}

#[test]
fn non_contract_holder_can_knock_out_the_contract_holder() {
    let mut game = blank();
    contract(&mut game, 1, "三光");
    game.hyper_hp = Some([18, 2]);
    game.hands = [vec![0], vec![8]];
    game.field = vec![1];
    game.play(0, 0, None).unwrap();
    assert_eq!(game.round_points, 8);
    assert_eq!(game.winner, Some(0));
}

#[test]
fn multiplier_has_several_paths_but_never_exceeds_eight() {
    let mut game = blank();
    contract(&mut game, 0, "青短");
    game.hyper_turn_captures[0] = 1;
    game.queue_hyper_effects(0, &[0, 1]);
    assert_eq!(game.hyper_multiplier(0), 200);
    game.hyper_chain[0] = 4;
    assert_eq!(game.hyper_multiplier(0), 250);
    game.add_hyper_boost(0, 2);
    assert_eq!(game.hyper_multiplier(0), 300);
    contract(&mut game, 0, "タネ");
    contract(&mut game, 0, "カス");
    game.hyper_chain[0] = 12;
    game.add_hyper_boost(0, 255);
    assert_eq!(game.hyper_multiplier(0), 800);
}

#[test]
fn reversal_miss_triggers_once_and_ribbon_targets_match_client_protocol() {
    let mut game = blank();
    contract(&mut game, 0, "月見で一杯");
    game.deck = vec![40, 41];
    game.capture_or_place(0, 0, &[], None);
    game.capture_or_place(0, 8, &[], None);
    assert_eq!(game.hyper_boosts[0], 2);
    assert_eq!(game.hyper_pending_draws[0], 0);
    assert_eq!(game.hyper_bloom[1], 2);
    contract(&mut game, 0, "赤短");
    game.hands[0] = vec![1];
    game.field = vec![5, 13];
    assert_eq!(game.hand_targets(0)[0].targets, vec![5]);
    assert!(game.hand_targets(1).is_empty());
    game.field.push(2);
    assert_eq!(game.hand_targets(0)[0].targets, vec![2]);
}

#[test]
fn reset_and_score_state_clear_between_rounds_and_options_belong_to_turn_owner() {
    let mut game = blank();
    game.phase = Phase::Decision;
    game.captured[1] = vec![1, 5, 9];
    assert!(game.hyper_options(1).is_empty());
    contract(&mut game, 0, "三光");
    game.hyper_hp = Some([3, 4]);
    game.hyper_boosts = [8, 8];
    game.hyper_stake = [5, 5];
    game.settle(None, 0);
    game.next_round().unwrap();
    assert!(game.hyper_hp.is_none());
    assert_eq!(game.hyper_stake, [0, 0]);
    assert_eq!(game.hyper_boosts, [0, 0]);
    assert!(game.hyper_contracts.iter().all(Vec::is_empty));
}

#[test]
fn light_contracts_are_distinct_and_actual_role_points_set_the_cost() {
    let ids: std::collections::HashSet<_> = ["三光", "雨四光", "四光", "五光"].map(|r| hyper_contract_for_role(r).unwrap().id).into_iter().collect();
    assert_eq!(ids.len(), 4);
    let mut game = blank();
    game.captured[0] = (0..48).filter(|c| (!BRIGHTS.contains(c) && !ANIMALS.contains(c) && !RIBBONS.contains(c)) || *c == 32).take(15).collect();
    game.phase = Phase::Decision;
    let option = game.hyper_options(0).into_iter().find(|o| o.role == "カス").unwrap();
    assert_eq!(option.points, 6);
    assert_eq!(option.contract.points, 6);
    game.hyper(0, "カス".into()).unwrap();
    assert_eq!(game.cashout_minimum(0), 6);
    assert_eq!(game.hyper_stake[0], 6);
}

#[test]
fn duel_uses_role_increases_once_and_light_upgrades_only_add_the_difference() {
    let mut game = blank();
    contract(&mut game, 0, "三光");
    game.hyper_hp = Some([32; 2]);
    game.captured[0] = vec![0, 8];
    game.field = vec![29, 45];
    game.capture_or_place(0, 28, &[29], None);
    let first = game.hyper_damage[0].clone();
    assert_eq!((first.cards, first.roles, first.chain, first.contract, first.power), (2, 5, 0, 1, 8));
    assert_eq!(first.role_gains, vec![Yaku { name: "三光".into(), points: 5 }]);
    game.capture_or_place(0, 44, &[45], None);
    let upgraded = &game.hyper_damage[0];
    assert_eq!((upgraded.roles, upgraded.contract, upgraded.power), (3, 0, 5));
    assert_eq!(upgraded.role_gains[0].name, "四光");
    game.field.push(5);
    game.capture_or_place(0, 4, &[5], None);
    assert_eq!(game.hyper_damage[0].roles, 0);
}

#[test]
fn simultaneous_roles_chain_and_caps_distinguish_power_from_hp_loss() {
    let mut game = blank();
    contract(&mut game, 0, "三光");
    game.hyper_hp = Some([32, 3]);
    game.hyper_chain[0] = 2;
    game.captured[0] = vec![0, 28, 1, 5, 33, 37];
    game.field = vec![9,10,11];
    game.capture_or_place(0, 8, &[9,10,11], None); // 三光 + 赤短 = 10 role damage.
    let hit = &game.hyper_damage[0];
    assert_eq!((hit.roles, hit.chain, hit.contract, hit.power, hit.damage), (10, 1, 1, 16, 3));
    assert_eq!((hit.hp_before, hit.hp_after), (3, 0));
    assert!(game.log.iter().any(|line| line.contains("威力16 / HP減少3")));
    let before = vec![];
    let after = vec![Yaku { name: "三光".into(), points: 5 }, Yaku { name: "赤短".into(), points: 5 }, Yaku { name: "青短".into(), points: 5 }];
    assert_eq!(total(&role_increases(&before, &after)).min(10), 10);
}

#[test]
fn non_storm_lights_do_not_change_combat_power_or_defense() {
    let mut game = blank();
    contract(&mut game, 1, "四光");
    contract(&mut game, 1, "五光");
    game.hyper_hp = Some([32; 2]);
    game.field = vec![1, 5];
    game.capture_or_place(0, 0, &[1], None);
    assert_eq!((game.hyper_damage[0].exposure, game.hyper_damage[0].blocked, game.hyper_damage[0].power), (0, 0, 2));
}

#[test]
fn trap_is_public_atomic_once_per_turn_and_expires_without_redeal() {
    let mut game = blank();
    contract(&mut game, 0, "雨四光");
    game.hands = [vec![8, 12], vec![16, 20]];
    game.field = vec![1, 5];
    let before = format!("{game:?}");
    assert!(game.set_trap(0, 1, game.board_revision + 1, TrapKind::Levy).is_err());
    assert!(game.set_trap(0, 2, game.board_revision, TrapKind::Levy).is_err());
    assert!(game.set_trap(1, 1, game.board_revision, TrapKind::Levy).is_err());
    assert_eq!(format!("{game:?}"), before);
    let turn = game.turn;
    game.set_trap(0, 1, game.board_revision, TrapKind::Levy).unwrap();
    assert_eq!(game.turn, turn);
    assert_eq!(game.phase, Phase::Play);
    assert_eq!(game.hyper_state(None).unwrap().traps, [Some(1), None]);
    assert!(!game.can_set_trap(0));
    let once = format!("{game:?}");
    assert!(game.set_trap(0, 5, game.board_revision, TrapKind::Levy).is_err());
    assert_eq!(format!("{game:?}"), once);
    game.play(0, 8, None).unwrap();
    assert_eq!(game.hyper_traps[0], Some(1));
    game.play(1, 16, None).unwrap();
    assert_eq!(game.turn, 0);
    assert_eq!(game.hyper_traps[0], None);
    assert!(game.can_set_trap(0));
}

#[test]
fn either_side_or_simultaneous_ko_stops_stock_and_settles() {
    for (hp, expected) in [([32, 0], Some(0)), ([0, 32], Some(1)), ([0, 0], None)] {
        let mut game = blank();
        game.hyper_hp = Some(hp);
        game.turn = 1;
        game.deck = vec![12];
        game.hyper_pending_draws = [1, 2];
        game.finish_draw_chain();
        assert_eq!(game.winner, expected);
        assert_eq!(game.phase, Phase::RoundEnd);
        assert_eq!(game.deck, vec![12]);
        assert_eq!(game.hyper_pending_draws, [0, 0]);
        if expected.is_none() { assert_eq!(game.round_points, 0); }
    }
}

#[test]
fn preview_matches_capture_and_reveals_only_own_hand_or_exposed_draw_choice() {
    let mut game = blank();
    contract(&mut game, 0, "五光");
    game.hyper_hp = Some([32; 2]);
    game.captured[0] = vec![0, 8];
    game.hands = [vec![28], vec![12]];
    game.field = vec![29, 30];
    game.hyper_traps[1] = Some(29);
    let before = format!("{game:?}");
    let previews = game.damage_previews(0);
    assert_eq!(previews.len(), 2);
    assert_eq!(format!("{game:?}"), before);
    assert!(game.hyper_state(None).unwrap().damage_previews.is_empty());
    assert!(game.damage_previews(1).is_empty());
    game.capture_or_place(0, 28, &[29, 30], Some(29));
    assert_eq!(previews[0].damage, game.hyper_damage);
    game.hyper_traps[0] = Some(30);
    game.turn = 0;
    game.phase = Phase::DrawChoice;
    assert!(game.set_trap(0, 30, game.board_revision, TrapKind::Levy).is_err());
    game.hyper_reset_board();
    assert_eq!(game.hyper_traps, [None; 2]);
}

#[test]
fn own_trap_capture_disarms_without_damage_and_next_round_clears_trap_budgets() {
    let mut game = blank();
    contract(&mut game, 0, "雨四光");
    game.hyper_hp = Some([32; 2]);
    game.field = vec![1];
    game.set_trap(0, 1, game.board_revision, TrapKind::Levy).unwrap();
    game.capture_or_place(0, 0, &[1], None);
    assert_eq!(game.hyper_traps, [None; 2]);
    assert_eq!(game.hyper_damage.len(), 1);
    assert_eq!(game.hyper_hp.unwrap()[0], 32);
    game.settle(None, 0);
    game.next_round().unwrap();
    assert_eq!(game.hyper_trap_used, [false; 2]);
    assert_eq!(game.hyper_attack_used, [false; 2]);
}

#[test]
fn drawn_choice_previews_only_the_revealed_card_and_match_the_selected_trap_target() {
    let mut game = blank();
    contract(&mut game, 1, "雨四光");
    game.hyper_hp = Some([32; 2]);
    game.phase = Phase::DrawChoice;
    game.drawn_card = Some(0);
    game.hands = [vec![20], vec![24]];
    game.field = vec![1, 2];
    game.hyper_traps[1] = Some(1);
    let previews = game.hyper_state(Some(0)).unwrap().damage_previews;
    assert_eq!(previews.len(), 2);
    assert!(previews.iter().all(|p| p.card_id == 0));
    assert_eq!(previews[0].damage.len(), 1);
    assert_eq!(previews[1].damage.len(), 1);
    assert!(game.hyper_state(Some(1)).unwrap().damage_previews.is_empty());
    game.choose(0, 1).unwrap();
    assert_eq!(game.events.last().unwrap().hyper.as_ref().unwrap().damage, previews[0].damage);
    assert_eq!(game.hyper_hp, Some([32, 30]));
}

#[test]
fn category_effects_differ_while_preserving_the_shared_starter_draw() {
    for role in ["赤短", "青短", "花見で一杯", "月見で一杯", "タネ", "短冊", "カス", "三光", "雨四光", "四光", "五光"] {
        let mut g = blank();
        contract(&mut g, 0, role);
        g.deck = (0..48).collect();
        g.hyper_chain[0] = 1;
        g.hyper_turn_captures[0] = 1;
        g.queue_hyper_effects(0, &[32, 1, 2]);
        assert_eq!(g.hyper_pending_draws[0], 1, "{role}");
        assert!(g.hyper_chain[0] >= 1);
    }
    let mut night = blank();
    contract(&mut night, 0, "月見で一杯");
    night.capture_or_place(0, 2, &[], None);
    night.capture_or_place(0, 3, &[], None);
    assert_eq!(night.hyper_boosts, [2, 0]);
    assert_eq!(night.hyper_bloom, [0, 2]);
    assert_eq!(night.hyper_pending_draws, [0, 0]);
}

#[test]
fn sacrifice_points_scale_bounty_chain_and_chaff_with_bounded_budgets() {
    for points in [1, 2, 3, 9] {
        let strength = points.min(3);
        let mut hunt = blank();
        contract(&mut hunt, 0, "タネ");
        hunt.hyper_contracts[0][0].points = points;
        hunt.hyper_bloom[1] = 5;
        for _ in 0..3 { hunt.queue_hyper_effects(0, &[4, 12]); }
        assert_eq!(hunt.hyper_bloom, [1 + strength, 5 - strength]);
        hunt.reset_hyper_turn(0);
        hunt.hyper_bloom[1] = 0;
        hunt.queue_hyper_effects(0, &[4]);
        assert_eq!(hunt.hyper_bloom[0], 2 + strength);
        let mut ink = blank();
        contract(&mut ink, 0, "短冊");
        ink.hyper_contracts[0][0].points = points;
        ink.hyper_chain[0] = 2;
        ink.queue_hyper_effects(0, &[1]);
        ink.hyper_chain[0] += 1;
        ink.queue_hyper_effects(0, &[5]);
        assert_eq!(ink.hyper_chain[0], 3 + strength as u8);
        assert_eq!(ink.hyper_pending_draws[0], 0);
        assert_eq!(ink.hyper_overdrive_used[0], if strength == 3 { 2 } else { 1 });
        let mut grass = blank();
        contract(&mut grass, 0, "カス");
        grass.hyper_contracts[0][0].points = points;
        grass.queue_hyper_effects(0, &[2, 3]);
        assert_eq!(grass.hyper_bloom[0], 2 * strength);
        grass.queue_hyper_effects(0, &[6, 7]);
        grass.queue_hyper_effects(0, &[10]);
        assert_eq!(grass.hyper_bloom[0], 3 * strength);
        assert_eq!(grass.hyper_pending_draws[0], 0);
    }
}

#[test]
fn chain_reserves_only_one_extra_draw_per_turn_even_when_ink_crosses_two_milestones() {
    let mut g = blank();
    contract(&mut g, 0, "短冊");
    g.hyper_contracts[0][0].points = 3;
    g.deck = (0..48).collect();
    g.hyper_chain[0] = 3;
    g.queue_hyper_effects(0, &[1]); // 2 -> 6, two milestones in one acquisition
    assert_eq!(g.hyper_chain[0], 6);
    assert_eq!(g.hyper_boosts[0], 2);
    assert_eq!(g.hyper_pending_draws[0], 1);
    for chain in [9, 12, 15] {
        g.hyper_chain[0] = chain;
        g.queue_hyper_effects(0, &[2]);
    }
    assert_eq!(g.hyper_pending_draws[0], 1);
    assert_eq!(g.hyper_boosts[0], 2);
    g.reset_hyper_turn(0);
    g.hyper_chain[0] = 18;
    g.queue_hyper_effects(0, &[2]);
    assert_eq!(g.hyper_pending_draws[0], 1);

    let mut light = blank();
    contract(&mut light, 1, "三光");
    light.hyper_chain[1] = 3;
    assert_eq!(light.counter_draw_budget(0), 0); // no automatic acceleration against a light contract
}


#[test]
fn only_storm_enters_duel_and_other_light_contracts_preserve_existing_hp() {
    for (role, cards) in [("三光", vec![0,8,28]), ("雨四光", vec![0,8,28,40]),
        ("四光", vec![0,8,28,44]), ("五光", vec![0,8,28,40,44])] {
        for existing in [None, Some([7, 9])] {
            let mut g = blank();
            g.captured[0] = cards.clone();
            g.deck = (0..48).filter(|c| !cards.contains(c)).collect();
            g.phase = Phase::Decision;
            g.hyper_hp = existing;
            g.hyper(0, role.into()).unwrap();
            assert_eq!(g.hyper_hp, existing.or(if role == "三光" { Some([32;2]) } else { None }));
            assert!(g.hyper_state(None).unwrap().intel.opponent_hand.is_empty());
            assert!(g.hyper_state(None).unwrap().intel.next_card.is_none());
        }
    }
}

#[test]
fn trap_lottery_is_stable_private_and_rejects_unoffered_choices_atomically() {
    for seed in 0..100 {
        let mut g = Game::with_rng(1, true, StdRng::seed_from_u64(seed));
        contract(&mut g, 0, "雨四光");
        g.turn = 0; g.phase = Phase::Play;
        g.reset_hyper_turn(0);
        let state = g.hyper_state(Some(0)).unwrap();
        assert_eq!(state.trap_choices.len(), 2);
        assert_ne!(state.trap_choices[0], state.trap_choices[1]);
        assert_eq!(state.trap_choices, g.hyper_state(Some(0)).unwrap().trap_choices);
        assert!(g.hyper_state(Some(1)).unwrap().trap_choices.is_empty());
        assert!(g.hyper_state(None).unwrap().trap_choices.is_empty());
        let unoffered = [TrapKind::Levy, TrapKind::Reveal, TrapKind::Bind].into_iter().find(|k| !state.trap_choices.contains(k)).unwrap();
        let before = format!("{g:?}");
        assert!(g.set_trap(0, g.field[0], g.board_revision, unoffered).is_err());
        assert_eq!(format!("{g:?}"), before);
        g.set_trap(0, g.field[0], g.board_revision, state.trap_choices[0]).unwrap();
        assert_eq!(g.hyper_state(Some(0)).unwrap().trap_kinds[0], Some(state.trap_choices[0]));
        assert_eq!(g.hyper_state(Some(1)).unwrap().trap_kinds, [None;2]);
        assert_eq!(g.hyper_state(None).unwrap().trap_kinds, [None;2]);
    }
}

#[test]
fn three_traps_work_without_hp_and_reveal_no_private_cards_in_public_events() {
    for kind in [TrapKind::Levy, TrapKind::Reveal, TrapKind::Bind] {
        let mut g = blank();
        contract(&mut g, 0, "雨四光");
        contract(&mut g, 1, "青短");
        g.hands = [vec![20], vec![0,12,16,24]];
        g.field = vec![1];
        g.hyper_trap_choices[0] = vec![kind];
        g.hyper_bloom[1] = 3;
        g.set_trap(0, 1, g.board_revision, kind).unwrap();
        g.turn = 1;
        g.hands[1].remove(0);
        g.capture_or_place(1, 0, &[1], None);
        g.push_event(1, PublicGameEventSource::Hand, 0, vec![1], false);
        assert!(g.hyper_hp.is_none());
        let beat = g.events[0].hyper.as_ref().unwrap();
        assert_eq!(beat.trap_activations, vec![TrapActivation { owner:0, victim:1, card_id:1, kind,
            amount: match kind { TrapKind::Levy => 3, TrapKind::Reveal => 2, TrapKind::Bind => 0 } }]);
        assert_eq!(g.hyper_chain[1], 1);
        assert!(g.hyper_state(None).unwrap().intel.opponent_hand.is_empty());
        assert!(g.hyper_state(Some(1)).unwrap().intel.opponent_hand.is_empty());
        match kind {
            TrapKind::Levy => assert_eq!(g.hyper_bloom, [3,0]),
            TrapKind::Reveal => {
                let intel = g.hyper_state(Some(0)).unwrap().intel.opponent_hand;
                assert_eq!(intel.len(), 2);
                assert!(intel.iter().all(|c| g.hands[1].contains(c)));
                let public = serde_json::to_string(&g.events).unwrap();
                assert!(!public.contains("opponentHand"));
                g.reset_hyper_turn(1);
                assert_eq!(g.hyper_state(Some(0)).unwrap().intel.opponent_hand.len(), 2);
                g.reset_hyper_turn(0);
                assert!(g.hyper_state(Some(0)).unwrap().intel.opponent_hand.is_empty());
            }
            TrapKind::Bind => {
                assert_eq!(g.hyper_boosts[1], 0);
                assert!(g.hyper_growth_sealed[1]);
                g.deck = vec![4,8,12];
                g.hyper_chain[1] = 3;
                g.queue_hyper_effects(1, &[4]);
                assert_eq!(g.hyper_boosts[1], 0);
                assert!(g.hyper_pending_draws[1] > 0);
                g.reset_hyper_turn(1);
                assert!(!g.hyper_growth_sealed[1]);
                g.add_hyper_boost(1, 1);
                assert_eq!(g.hyper_boosts[1], 1);
            }
        }
        assert!(g.hyper_traps.iter().all(Option::is_none));
    }
}

#[test]
fn sight_reveals_only_authorized_hand_and_next_stock_and_changes_cpu_choices() {
    let mut g = blank();
    g.hands = [vec![0,4], vec![12,16]];
    g.field = vec![8];
    g.deck = vec![24,1];
    assert!(g.move_value(0,0,None) < g.move_value(0,4,None));
    contract(&mut g, 0, "四光");
    let intel = g.hyper_state(Some(0)).unwrap().intel;
    assert_eq!(intel.opponent_hand, vec![12,16]);
    assert_eq!(intel.next_card, Some(1));
    assert!(g.move_value(0,0,None) > g.move_value(0,4,None));
    assert!(g.hyper_state(Some(1)).unwrap().intel.opponent_hand.is_empty());
    assert!(g.hyper_state(None).unwrap().intel.next_card.is_none());
    g.turn = 1;
    assert_eq!(g.hyper_state(Some(0)).unwrap().intel.next_card, None);
    assert_eq!(g.hyper_state(Some(0)).unwrap().intel.opponent_hand, vec![12,16]);
    g.settle(None,0);
    assert!(g.hyper_state(Some(0)).unwrap().intel.opponent_hand.is_empty());
}

#[test]
fn revelation_cross_month_requires_one_choice_not_a_three_card_sweep_and_costs_bloom() {
    let mut g = blank();
    contract(&mut g,0,"五光");
    g.hands = [vec![0,4], vec![12]];
    g.field = vec![8,16,24];
    assert_eq!(g.hand_targets(0)[0].targets, vec![8,16,24]);
    let before = format!("{g:?}");
    assert!(g.play(0,0,None).is_err());
    assert_eq!(format!("{g:?}"), before);
    g.capture_or_place(0,0,&[8,16,24],Some(16));
    assert_eq!(g.captured[0],vec![0,16]);
    assert_eq!(g.field,vec![8,24]);
    assert_eq!(g.hyper_bloom,[0,2]);
    assert!(g.matching(4).is_empty());
    g.reset_hyper_turn(0);
    assert_eq!(g.matching(4),vec![8,24]);
    g.field = vec![1,2,3];
    assert!(Game::takes_three(0,&g.matching(0)));
    g.capture_or_place(0,0,&[1,2,3],None);
    assert_eq!(g.hyper_bloom,[0,2]); // ordinary three-card sweep incurs no penalty
}

#[test]
fn redeal_and_forfeit_clear_old_traps_reveals_and_growth_penalties() {
    let mut g = blank();
    contract(&mut g,0,"雨四光");
    contract(&mut g,0,"四光");
    g.hands = [vec![8], vec![12]]; g.field = vec![1];
    g.deck = (0..48).filter(|c| ![8,12,1].contains(c)).collect();
    g.set_trap(0,1,g.board_revision,TrapKind::Levy).unwrap();
    g.hyper_revealed[0] = vec![12]; g.hyper_growth_sealed[1] = true;
    g.hyper_reset_board();
    assert_eq!(g.hyper_traps,[None;2]);
    assert_eq!(g.hyper_trap_kinds,[None;2]);
    assert!(g.hyper_revealed.iter().all(Vec::is_empty));
    assert_eq!(g.hyper_growth_sealed,[false;2]);
    let kind = g.hyper_trap_choices[0][0];
    g.set_trap(0,g.field[0],g.board_revision,kind).unwrap();
    g.hyper_growth_sealed[1] = true;
    g.forfeit(1).unwrap();
    let view = g.hyper_state(Some(0)).unwrap();
    assert_eq!(view.traps,[None;2]);
    assert!(view.trap_choices.is_empty());
    assert!(view.intel.opponent_hand.is_empty());
    assert!(view.intel.next_card.is_none());
    assert_eq!(view.growth_sealed,[false;2]);
}
