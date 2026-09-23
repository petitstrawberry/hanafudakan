//! Reproducible balance probe: cargo test hyper_balance_simulation -- --ignored --nocapture
use super::*;
use serde_json::json;

#[test]
#[ignore = "2000 seeded CPU rounds; run explicitly for balance reports"]
fn hyper_balance_simulation() {
    let count = std::env::var("HYPER_SIM_SEEDS").ok().and_then(|n| n.parse().ok()).unwrap_or(2000);
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
        "actionsMedian": steps[1000], "actionsP95": steps[1900], "actionsMax": steps[1999],
        "payoutMedian": payouts[1000], "payoutP95": payouts[1900], "payoutMax": payouts[1999],
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
            "seeds": "0..2000, both seats", "roundsPerMatch": 3,
            "resetVariant": variant,
            "balanceVariant": balance_variant,
        }));
    }
}
