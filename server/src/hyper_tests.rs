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
fn contracted_player_needs_a_role_at_least_as_large_as_the_largest_contract() {
    let mut game = blank();
    contract(&mut game, 0, "花見で一杯"); // 5 points
    contract(&mut game, 0, "タネ"); // 1 point; thresholds do not add up
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

    let mut met = blank();
    contract(&mut met, 0, "花見で一杯");
    contract(&mut met, 0, "青短");
    met.captured[0] = vec![8, 32]; // 花見で一杯 5 points
    met.phase = Phase::Decision;
    assert_eq!(met.cashout_minimum(0), 5);
    met.decision(0, false).unwrap();
    assert_eq!(met.winner, Some(0));
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
    assert_eq!(game.hyper_bloom[0], 7); // two feasts + three chaff bonuses
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
    assert_eq!(game.hyper_pending_draws[0], 1);
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
