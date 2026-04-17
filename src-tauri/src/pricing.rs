//! Per-model pricing table + cost calculator. Used to derive `cost_usd` for
//! paid-provider turns. Ollama models are absent from the table by design
//! (local inference is $0 to the user).
//!
//! Bundled prices are snapshot values; users can override any model via
//! `AppSettings.pricing_overrides` without waiting for a Loom release.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// Pricing for one model, in USD per million tokens. `cached_input_per_mtoken_usd`
/// applies to tokens read from a provider prompt cache (e.g. Anthropic's
/// `cache_read_input_tokens`). When None, cached tokens bill at the standard
/// input rate.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelPricing {
    pub input_per_mtoken_usd: f64,
    pub output_per_mtoken_usd: f64,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub cached_input_per_mtoken_usd: Option<f64>,
}

/// Bundled 2026-04 prices. Keys match the exact `model_id` each provider
/// returns (so the lookup is a straight HashMap hit, no normalization).
pub fn bundled_prices() -> HashMap<String, ModelPricing> {
    let mut m = HashMap::new();

    // Anthropic Claude 4 family (per Anthropic pricing page, Apr 2026 snapshot).
    // Sources noted in feat-loom-042.
    m.insert(
        "claude-opus-4-7".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 15.0,
            output_per_mtoken_usd: 75.0,
            cached_input_per_mtoken_usd: Some(1.50),
        },
    );
    m.insert(
        "claude-opus-4-20250514".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 15.0,
            output_per_mtoken_usd: 75.0,
            cached_input_per_mtoken_usd: Some(1.50),
        },
    );
    m.insert(
        "claude-sonnet-4-6".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 3.0,
            output_per_mtoken_usd: 15.0,
            cached_input_per_mtoken_usd: Some(0.30),
        },
    );
    m.insert(
        "claude-sonnet-4-20250514".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 3.0,
            output_per_mtoken_usd: 15.0,
            cached_input_per_mtoken_usd: Some(0.30),
        },
    );
    m.insert(
        "claude-haiku-4-5".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 1.0,
            output_per_mtoken_usd: 5.0,
            cached_input_per_mtoken_usd: Some(0.10),
        },
    );
    m.insert(
        "claude-haiku-4-5-20251001".to_string(),
        ModelPricing {
            input_per_mtoken_usd: 1.0,
            output_per_mtoken_usd: 5.0,
            cached_input_per_mtoken_usd: Some(0.10),
        },
    );

    m
}

/// Resolve pricing for a model. Override table wins over bundled defaults.
pub fn lookup(model: &str, overrides: &HashMap<String, ModelPricing>) -> Option<ModelPricing> {
    if let Some(p) = overrides.get(model) {
        return Some(p.clone());
    }
    bundled_prices().get(model).cloned()
}

/// Compute total cost in USD given token counts and a pricing entry.
///
/// Anthropic's `usage.input_tokens` excludes cache-read tokens (they're counted
/// separately), so for Anthropic we bill:
///     input_tokens  × input_rate
///   + cached_tokens × cached_rate (cache_read only; cache_creation ignored in v1)
///   + output_tokens × output_rate
///
/// For providers that don't distinguish (e.g. hypothetical future OpenAI where
/// `prompt_tokens_details.cached_tokens` IS a subset of `prompt_tokens`),
/// callers must subtract cached from prompt_eval_count before calling, OR the
/// caller should treat cached_tokens as additive input (the Anthropic shape).
/// Loom follows the Anthropic shape.
pub fn compute_cost(
    prompt_eval_count: Option<u32>,
    eval_count: Option<u32>,
    cached_tokens: Option<u32>,
    pricing: &ModelPricing,
) -> f64 {
    let input = prompt_eval_count.unwrap_or(0) as f64;
    let output = eval_count.unwrap_or(0) as f64;
    let cached = cached_tokens.unwrap_or(0) as f64;
    let cached_rate = pricing
        .cached_input_per_mtoken_usd
        .unwrap_or(pricing.input_per_mtoken_usd);
    (input * pricing.input_per_mtoken_usd
        + cached * cached_rate
        + output * pricing.output_per_mtoken_usd)
        / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn overrides() -> HashMap<String, ModelPricing> {
        HashMap::new()
    }

    #[test]
    fn lookup_returns_bundled_price_for_known_model() {
        let p = lookup("claude-opus-4-7", &overrides()).expect("opus 4.7 is bundled");
        assert_eq!(p.input_per_mtoken_usd, 15.0);
        assert_eq!(p.output_per_mtoken_usd, 75.0);
        assert_eq!(p.cached_input_per_mtoken_usd, Some(1.50));
    }

    #[test]
    fn lookup_returns_none_for_unknown_model() {
        assert!(lookup("llama3.1:8b", &overrides()).is_none());
        assert!(lookup("gpt-42-ultra", &overrides()).is_none());
    }

    #[test]
    fn override_wins_over_bundled() {
        let mut ov = HashMap::new();
        ov.insert(
            "claude-opus-4-7".to_string(),
            ModelPricing {
                input_per_mtoken_usd: 1.0,
                output_per_mtoken_usd: 2.0,
                cached_input_per_mtoken_usd: None,
            },
        );
        let p = lookup("claude-opus-4-7", &ov).unwrap();
        assert_eq!(p.input_per_mtoken_usd, 1.0);
        assert_eq!(p.output_per_mtoken_usd, 2.0);
        assert!(p.cached_input_per_mtoken_usd.is_none());
    }

    #[test]
    fn compute_cost_math_is_correct() {
        let p = ModelPricing {
            input_per_mtoken_usd: 10.0,
            output_per_mtoken_usd: 30.0,
            cached_input_per_mtoken_usd: Some(1.0),
        };
        // 1000 input × $10/M = $0.01
        // 500 cached × $1/M = $0.0005
        // 200 output × $30/M = $0.006
        // total = $0.0165
        let cost = compute_cost(Some(1000), Some(200), Some(500), &p);
        assert!((cost - 0.0165).abs() < 1e-9, "expected ~0.0165, got {cost}");
    }

    #[test]
    fn compute_cost_with_no_cached_tokens_uses_zero() {
        let p = ModelPricing {
            input_per_mtoken_usd: 10.0,
            output_per_mtoken_usd: 30.0,
            cached_input_per_mtoken_usd: Some(1.0),
        };
        // 1000 × $10 + 0 × $1 + 200 × $30 = $0.01 + 0 + $0.006 = $0.016
        let cost = compute_cost(Some(1000), Some(200), None, &p);
        assert!((cost - 0.016).abs() < 1e-9);
    }

    #[test]
    fn compute_cost_without_cached_rate_bills_at_input_rate() {
        let p = ModelPricing {
            input_per_mtoken_usd: 10.0,
            output_per_mtoken_usd: 30.0,
            cached_input_per_mtoken_usd: None,
        };
        // cached_tokens falls back to input rate
        // 1000 × $10 + 500 × $10 + 200 × $30 = $0.01 + $0.005 + $0.006 = $0.021
        let cost = compute_cost(Some(1000), Some(200), Some(500), &p);
        assert!((cost - 0.021).abs() < 1e-9);
    }

    #[test]
    fn compute_cost_all_none_is_zero() {
        let p = ModelPricing {
            input_per_mtoken_usd: 10.0,
            output_per_mtoken_usd: 30.0,
            cached_input_per_mtoken_usd: Some(1.0),
        };
        assert_eq!(compute_cost(None, None, None, &p), 0.0);
    }
}
