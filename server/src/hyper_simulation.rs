//! Reproducible balance probe: cargo test hyper_balance_simulation -- --ignored --nocapture
use super::*;
use serde_json::json;

#[test]
#[ignore = "2000 seeded CPU rounds; run explicitly for balance reports"]
fn hyper_balance_simulation() {
    let count = std::env::var("HYPER_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
    assert!(count > 0, "HYPER_SIM_SEEDS must be positive");
    let variant: u8 = std::env::var("HYPER_BALANCE_VARIANT").ok().and_then(|n| n.parse().ok()).unwrap_or(3);
    let mut draws = 0;
    let mut wins = [0; 2];
    let mut contracts = 0;
    let mut contracted_rounds = 0;
    let mut multi_contract_rounds = 0;
    let mut chain_rounds = 0;
    let mut empty_reset_decks = 0;
    let mut steps = Vec::new();
    let mut payouts = Vec::new();
    let mut peak_chains = Vec::new();
    let mut contract_counts = std::collections::BTreeMap::new();
    let mut first_contract_rounds = 0;
    let mut first_contract_wins = 0;
    let mut defender_wins_without_contract = 0;
    let mut defender_contracts = 0;
    let mut defender_decisions = 0;
    for seed in 0..count {
        let mut game = Game::with_rng(1, true, StdRng::seed_from_u64(seed));
        game.balance_variant = variant;
        let mut actions = 0;
        let mut peak = 0;
        let mut first_contractor = None;
        let mut defender_decided = false;
        while game.phase != Phase::Finished {
            if let Some(player) = first_contractor {
                defender_decided |= game.turn == 1 - player && game.phase == Phase::Decision;
            }
            let before: usize = game.hyper_contracts.iter().map(Vec::len).sum();
            game.cpu_action();
            let after: usize = game.hyper_contracts.iter().map(Vec::len).sum();
            if first_contractor.is_none() && after > before {
                first_contractor = Some(if !game.hyper_contracts[0].is_empty() { 0 } else { 1 });
            }
            if after > before && game.deck.is_empty() { empty_reset_decks += 1; }
            peak = peak.max(*game.hyper_chain.iter().max().unwrap());
            actions += 1;
            assert!(actions < 400, "stalled seed {seed}: {game:?}");
        }
        let n: usize = game.hyper_contracts.iter().map(Vec::len).sum();
        if let Some(player) = first_contractor {
            first_contract_rounds += 1;
            first_contract_wins += usize::from(game.winner == Some(player));
            defender_wins_without_contract += usize::from(game.winner == Some(1 - player) && game.hyper_contracts[1 - player].is_empty());
            defender_contracts += usize::from(!game.hyper_contracts[1 - player].is_empty());
            defender_decisions += usize::from(defender_decided);
        }
        for contract in game.hyper_contracts.iter().flatten() {
            *contract_counts.entry(contract.id.clone()).or_insert(0) += 1;
        }
        contracts += n;
        contracted_rounds += usize::from(n > 0);
        multi_contract_rounds += usize::from(game.hyper_contracts.iter().any(|c| c.len() >= 2));
        chain_rounds += usize::from(peak >= 3);
        match game.winner { Some(p) => wins[p] += 1, None => draws += 1 }
        steps.push(actions);
        payouts.push(game.round_points);
        peak_chains.push(peak);
    }
    steps.sort_unstable();
    payouts.sort_unstable();
    println!("HYPER_BALANCE {}", json!({
        "seeds": format!("0..{count}"), "rounds": count, "policy": "cpu_action", "wins": wins,
        "balanceVariant": variant, "firstContractRounds": first_contract_rounds,
        "firstContractWins": first_contract_wins, "defenderWinsWithoutContract": defender_wins_without_contract,
        "defenderContracts": defender_contracts, "defenderDecisions": defender_decisions,
        "draws": draws, "contracts": contracts, "contractedRounds": contracted_rounds,
        "multiContractRounds": multi_contract_rounds, "chain3Rounds": chain_rounds,
        "emptyResetDecks": empty_reset_decks, "contractCounts": contract_counts,
        "actionsMedian": steps[count as usize / 2], "actionsP95": steps[count as usize * 95 / 100], "actionsMax": steps[count as usize - 1],
        "payoutMedian": payouts[count as usize / 2], "payoutP95": payouts[count as usize * 95 / 100], "payoutMax": payouts[count as usize - 1],
        "peakChainMax": peak_chains.iter().max(),
    }));
}

fn policy_action(game: &mut Game, policy: &str) {
    if game.phase == Phase::Decision {
        if policy == "cashout" {
            if game.can_cash_out(game.turn) { game.decision(game.turn, false).unwrap(); }
            else if game.exhausted() {
                let role = game.hyper_options(game.turn).first().unwrap().role.clone();
                game.hyper(game.turn, role).unwrap();
            } else { game.decision(game.turn, true).unwrap(); }
            return;
        }
        if policy == "reckless" {
            if let Some(option) = game.hyper_options(game.turn).first() {
                game.hyper(game.turn, option.role.clone()).unwrap();
                return;
            }
            game.decision(game.turn, !game.can_cash_out(game.turn)).unwrap();
            return;
        }
    }
    game.cpu_action();
}

#[test]
#[ignore = "12000 seeded three-round matches with mirrored seats"]
fn hyper_strategy_simulation() {
    let variant: u8 = std::env::var("HYPER_RESET_VARIANT").unwrap_or_default().parse().unwrap_or(1);
    let balance_variant: u8 = std::env::var("HYPER_BALANCE_VARIANT").ok().and_then(|n| n.parse().ok()).unwrap_or(3);
    let seeds: u64 = std::env::var("HYPER_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
    assert!(seeds > 0, "HYPER_SIM_SEEDS must be positive");
    for (left, right) in [("reckless", "cashout"), ("balanced", "cashout"), ("balanced", "reckless")] {
        let mut wins = [0; 3];
        let mut score = [0u64; 2];
        let mut risk = [0; 2]; // contracted rounds, lost/drawn contracted rounds
        let mut knockouts = 0;
        let mut hp_rounds = 0;
        let mut max_actions = 0;
        for seed in 0..seeds {
            for mirror in 0..2 {
                let policies = if mirror == 0 { [left, right] } else { [right, left] };
                let mut game = Game::with_rng(3, true, StdRng::seed_from_u64(seed));
                game.balance_variant = balance_variant;
                game.reset_policy = match variant { 0 => ResetPolicy::KeepOpponent, 2 => ResetPolicy::KeepBestRole, _ => ResetPolicy::All };
                let mut actions = 0;
                loop {
                    let before_revision = game.board_revision;
                    if !matches!(game.phase, Phase::RoundEnd | Phase::Finished) {
                        let policy = policies[game.turn];
                        policy_action(&mut game, policy);
                    }
                    // Every real card stays in exactly one zone, including conversions.
                    let mut cards: Vec<_> = game.hands.iter().flatten().chain(game.captured.iter().flatten())
                        .chain(&game.field).chain(&game.deck).chain(game.drawn_card.iter()).copied().collect();
                    cards.sort_unstable();
                    assert_eq!(cards, (0..48).collect::<Vec<_>>(), "seed {seed}");
                    if game.board_revision != before_revision { assert!(!game.deck.is_empty()); }
                    if matches!(game.phase, Phase::RoundEnd | Phase::Finished) {
                        for p in 0..2 {
                            if !game.hyper_contracts[p].is_empty() {
                                risk[0] += 1;
                                risk[1] += usize::from(game.winner != Some(p));
                            }
                        }
                        hp_rounds += usize::from(game.hyper_hp.is_some());
                        knockouts += usize::from(game.hyper_hp.is_some_and(|hp| hp.contains(&0)));
                        if game.phase == Phase::Finished { break; }
                        game.next_round().unwrap();
                    }
                    actions += 1;
                    assert!(actions < 500, "strategy stalled at seed {seed}");
                }
                max_actions = max_actions.max(actions);
                match game.match_winner() {
                    Some(p) => wins[p ^ mirror] += 1,
                    None => wins[2] += 1,
                }
                for p in 0..2 { score[p ^ mirror] += u64::from(game.scores[p]); }
            }
        }
        println!("HYPER_STRATEGY {}", json!({
            "policies": [left, right], "matches": seeds * 2, "winsAndTies": wins,
            "totalScore": score, "contractedPlayerRounds": risk[0], "lostContractedPlayerRounds": risk[1],
            "hpRounds": hp_rounds, "knockouts": knockouts, "maxActions": max_actions,
            "seeds": format!("0..{seeds}, both seats"), "roundsPerMatch": 3,
            "resetVariant": variant,
            "balanceVariant": balance_variant,
        }));
    }
}
#[test]
#[ignore = "seeded distinct light-contract effects and combat tempo comparison"]
fn hyper_light_contract_simulation() {
    let seeds: u64 = std::env::var("HYPER_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
    assert!(seeds > 0, "HYPER_SIM_SEEDS must be positive");
    let isolated = std::env::var("HYPER_SIM_ISOLATED").is_ok_and(|value| value == "true");
    for (role, cards) in [("三光", vec![0,8,28]), ("雨四光", vec![0,8,28,40]), ("四光", vec![0,8,28,44]), ("五光", vec![0,8,28,40,44])] {
        let mut wins = [0; 3];
        let mut knockouts = 0;
        let mut captures = Vec::new();
        let mut actions = Vec::new();
        let mut damage = std::collections::BTreeMap::new();
        let mut combat_turns = Vec::new();
        let mut defender_turns = Vec::new();
        let mut full_hp_turn_kos = 0;
        let mut ko_captures = Vec::new();
        let mut traps_fired = 0;
        let mut trap_kinds = std::collections::BTreeMap::new();
        let mut cross_month_captures = 0;
        let mut hp_starts = 0;
        let mut payouts: [Vec<u32>; 2] = [vec![], vec![]];
        for seed in 0..seeds {
            for seat in 0..2 {
                let mut game = Game::with_rng(1, true, StdRng::seed_from_u64(seed));
                game.hands = [vec![], vec![]];
                game.field.clear();
                game.captured = [vec![], vec![]];
                game.captured[seat] = cards.clone();
                game.deck = (0..48).filter(|c| !cards.contains(c)).collect();
                game.turn = seat;
                game.phase = Phase::Decision;
                game.hyper(seat, role.into()).unwrap();
                let mut steps = 0;
                let mut takes = 0;
                let mut turns = 0;
                let mut answers = 0;
                let mut turn_start_hp = game.hyper_hp;
                loop {
                    let seq = game.event_sequence();
                    let hp = game.hyper_hp;
                    let actor = game.turn;
                    if game.phase == Phase::Play {
                        turn_start_hp = game.hyper_hp;
                        turns += 1;
                        answers += usize::from(actor != seat);
                    }
                    if isolated && game.phase == Phase::Decision {
                        if game.can_cash_out(game.turn) { game.decision(game.turn, false).unwrap(); }
                        else if game.exhausted() { game.settle(None, 0); }
                        else { game.decision(game.turn, true).unwrap(); }
                    } else { game.cpu_action(); }
                    hp_starts += usize::from(hp.is_none() && game.hyper_hp.is_some());
                    for event in game.events.iter().filter(|e| e.id > seq) {
                        traps_fired += event.hyper.as_ref().map_or(0, |h| h.trap_activations.len());
                        if let Some(beat) = &event.hyper {
                            for activation in &beat.trap_activations {
                                *trap_kinds.entry(activation.kind.name()).or_insert(0usize) += 1;
                            }
                        }
                        cross_month_captures += usize::from(event.target_ids.iter().any(|&c| month(c) != month(event.card_id)));
                    }
                    full_hp_turn_kos += usize::from(turn_start_hp.is_some_and(|h| h[1 - actor] == duel_hp()) && hp.is_some_and(|h| h[1 - actor] > 0) && game.hyper_hp.is_some_and(|h| h[1 - actor] == 0));
                    takes += game.events.iter().filter(|e| e.id > seq && e.captured).count();
                    if let (Some(before), Some(after)) = (hp, game.hyper_hp) {
                        for p in 0..2 {
                            let delta = before[p].saturating_sub(after[p]);
                            if delta > 0 { *damage.entry(delta).or_insert(0) += 1; }
                        }
                    }
                    let mut all: Vec<_> = game.hands.iter().flatten().chain(game.captured.iter().flatten()).chain(&game.field).chain(&game.deck).chain(game.drawn_card.iter()).copied().collect();
                    all.sort_unstable();
                    assert_eq!(all, (0..48).collect::<Vec<_>>(), "{role} seed {seed}");
                    steps += 1;
                    assert!(steps < 400, "{role} stalled seed {seed}");
                    if game.phase == Phase::Finished { break; }
                }
                match game.winner {
                    Some(p) if p == seat => { wins[0] += 1; payouts[0].push(game.round_points); }
                    Some(_) => { wins[1] += 1; payouts[1].push(game.round_points); }
                    None => wins[2] += 1,
                }
                knockouts += usize::from(game.hyper_hp.is_some_and(|hp| hp.contains(&0)));
                if game.hyper_hp.is_some_and(|h| h.contains(&0)) { ko_captures.push(takes); }
                captures.push(takes);
                combat_turns.push(turns);
                defender_turns.push(answers);
                actions.push(steps);
            }
        }
        captures.sort_unstable(); actions.sort_unstable(); combat_turns.sort_unstable(); defender_turns.sort_unstable(); ko_captures.sort_unstable();
        for values in &mut payouts { values.sort_unstable(); }
        let payout_medians = payouts.each_ref().map(|v| v.get(v.len()/2).copied());
        let n = captures.len();
        println!("HYPER_LIGHT {}", json!({"role":role,"seeds":seeds,"mirrored":true,"hp":duel_hp(),"isolated":isolated,"winningPayoutMedians":payout_medians,"rounds":n,"contractorWinsDefenderWinsDraws":wins,"knockouts":knockouts,"laterHpStarts":hp_starts,"trapsFired":traps_fired,"trapKindCounts":trap_kinds,"crossMonthCaptures":cross_month_captures,"capturesMedian":captures[n/2],"capturesP95":captures[n*95/100],"capturesMax":captures[n-1],"actionsMedian":actions[n/2],"actionsMax":actions[n-1],"hpLossPerAction":damage,"turnsMedian":combat_turns[n/2],"defenderTurnsMedian":defender_turns[n/2],"fullHpTurnKos":full_hp_turn_kos,"koCapturesMedian":ko_captures.get(ko_captures.len()/2)}));
    }
}

#[test]
#[ignore = "seeded contract families and 1/3-point strengths; mirrors both seats"]
fn hyper_contract_choice_simulation() {
    let seeds: u64 = std::env::var("HYPER_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(500);
    assert!(seeds > 0);
    for (role, cards) in [
        ("猪鹿蝶", vec![20,24,36]), ("赤短", vec![1,5,9]), ("青短", vec![21,33,37]),
        ("花見で一杯", vec![8,32]), ("月見で一杯", vec![28,32]),
        ("タネ", vec![4,12,16,20,24]), ("タネ", vec![4,12,16,20,24,32,36]),
        ("短冊", vec![1,5,13,17,21]), ("短冊", vec![1,5,13,17,21,25,33]),
        ("カス", vec![2,3,6,7,10,11,14,15,18,19]), ("カス", vec![2,3,6,7,10,11,14,15,18,19,22,23]),
    ] {
        let cost = evaluate(&cards).iter().find(|r| r.name == role).unwrap().points;
        let mut wins = [0; 3];
        let mut actions = vec![];
        let mut extra_draws = 0;
        let mut payout = vec![];
        for seed in 0..seeds {
            for seat in 0..2 {
                let mut g = Game::with_rng(1, true, StdRng::seed_from_u64(seed));
                g.hands = [vec![], vec![]]; g.field.clear(); g.captured = [vec![], vec![]];
                g.captured[seat] = cards.clone(); g.deck = (0..48).filter(|c| !cards.contains(c)).collect();
                g.turn = seat; g.phase = Phase::Decision;
                g.hyper(seat, role.into()).unwrap();
                let mut steps = 0;
                while g.phase != Phase::Finished {
                    let sequence = g.event_sequence();
                    g.cpu_action();
                    let draws = g.events.iter().filter(|e| e.id > sequence && e.player == seat && e.source == PublicGameEventSource::Draw).count();
                    extra_draws += draws.saturating_sub(1);
                    let mut all: Vec<_> = g.hands.iter().flatten().chain(g.captured.iter().flatten()).chain(&g.field).chain(&g.deck).chain(g.drawn_card.iter()).copied().collect();
                    all.sort_unstable(); assert_eq!(all, (0..48).collect::<Vec<_>>());
                    steps += 1; assert!(steps < 400, "{role}/{cost} seed {seed}");
                }
                match g.winner { Some(p) if p == seat => wins[0] += 1, Some(_) => wins[1] += 1, None => wins[2] += 1 }
                actions.push(steps); payout.push(g.round_points);
            }
        }
        actions.sort_unstable(); payout.sort_unstable(); let n = actions.len();
        println!("HYPER_CHOICES {}", json!({"role":role,"cost":cost,"rounds":n,"winsAndDraws":wins,"actionsMedian":actions[n/2],"actionsMax":actions[n-1],"payoutMedian":payout[n/2],"extraDrawsLowerBound":extra_draws,"policy":"cpu including later contracts; not isolated effect"}));
    }
}
