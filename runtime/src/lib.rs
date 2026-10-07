//! Thin JSON/closure bridge to the unchanged upstream temporal evaluator.
#![cfg_attr(not(any(target_arch = "wasm32", test)), allow(dead_code))]
use bombadil_ltl::{
    eval::{Evaluator, Value as Evaluation},
    formula::{Domain, Formula, State},
    syntax::Syntax,
    violation::Violation,
};
use bombadil_schema::{markup, schema};
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq)]
struct Predicate {
    id: u32,
    pretty: String,
}

#[derive(Clone, Debug, Default, PartialEq)]
struct Snapshots(BTreeMap<String, Value>);
impl State for Snapshots {
    fn merge(&self, other: &Self) -> Self {
        let mut merged = self.0.clone();
        merged.extend(other.0.clone());
        Self(merged)
    }
    fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}
#[derive(Clone, Debug, PartialEq)]
struct BrowserDomain;
impl Domain for BrowserDomain {
    type Function = Predicate;
    type Time = u64;
    type Duration = u64;
    type State = Snapshots;
}
#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
enum Wire {
    Pure {
        value: bool,
        pretty: String,
    },
    Thunk {
        id: u32,
        #[serde(default)]
        pretty: String,
    },
    Not {
        child: Box<Wire>,
    },
    And {
        left: Box<Wire>,
        right: Box<Wire>,
    },
    Or {
        left: Box<Wire>,
        right: Box<Wire>,
    },
    Implies {
        left: Box<Wire>,
        right: Box<Wire>,
    },
    Next {
        child: Box<Wire>,
    },
    Always {
        child: Box<Wire>,
        bound: Option<u64>,
    },
    Eventually {
        child: Box<Wire>,
        bound: Option<u64>,
    },
}
impl Wire {
    fn syntax(self) -> Syntax<BrowserDomain> {
        match self {
            Self::Pure { value, pretty } => Syntax::Pure { value, pretty },
            Self::Thunk { id, pretty } => Syntax::Thunk(Predicate { id, pretty }),
            Self::Not { child } => Syntax::Not(Box::new(child.syntax())),
            Self::And { left, right } => {
                Syntax::And(Box::new(left.syntax()), Box::new(right.syntax()))
            }
            Self::Or { left, right } => {
                Syntax::Or(Box::new(left.syntax()), Box::new(right.syntax()))
            }
            Self::Implies { left, right } => {
                Syntax::Implies(Box::new(left.syntax()), Box::new(right.syntax()))
            }
            Self::Next { child } => Syntax::Next(Box::new(child.syntax())),
            Self::Always { child, bound } => Syntax::Always(Box::new(child.syntax()), bound),
            Self::Eventually { child, bound } => {
                Syntax::Eventually(Box::new(child.syntax()), bound)
            }
        }
    }
}
struct Property {
    initial: Formula<BrowserDomain>,
    value: Option<Evaluation<BrowserDomain>>,
}
#[derive(Default)]
struct Run {
    properties: BTreeMap<String, Property>,
    last_time: Option<u64>,
}
impl Run {
    fn init(&mut self, properties: BTreeMap<String, Wire>) {
        self.properties = properties
            .into_iter()
            .map(|(name, wire)| {
                (
                    name,
                    Property {
                        initial: wire.syntax().nnf(),
                        value: None,
                    },
                )
            })
            .collect();
        self.last_time = None;
    }
    fn step(
        &mut self,
        time: u64,
        callback: &mut dyn FnMut(
            &Predicate,
            bool,
        ) -> Result<(Formula<BrowserDomain>, Snapshots), String>,
    ) -> Result<Value, String> {
        if self.last_time.is_some_and(|last| time < last) {
            return Err("Trace timestamps must be monotonic".into());
        }
        self.last_time = Some(time);
        let mut evaluator = Evaluator::new(callback);
        let mut result = serde_json::Map::new();
        for (name, property) in self.properties.iter_mut() {
            let value = match &property.value {
                None => evaluator.evaluate(&property.initial, time)?,
                Some(Evaluation::Residual(residual)) => evaluator.step(residual, time)?,
                Some(value) => value.clone(),
            };
            let summary = match &value {
                Evaluation::True(_) => json!({"status":"satisfied"}),
                Evaluation::Residual(_) => json!({"status":"pending"}),
                Evaluation::False(violation, _) => {
                    let report = markup::render_violation(&schema::PropertyViolation {
                        name: name.clone(),
                        violation: schema_violation(violation),
                    });
                    json!({"status":"violation","violation": describe(violation),
                        "report": markup_json(&report, report.root_id())})
                }
            };
            result.insert(name.clone(), summary);
            property.value = Some(value);
        }
        Ok(Value::Object(result))
    }
}

fn schema_time(millis: u64) -> schema::Time {
    schema::Time::from_system_time(std::time::SystemTime::UNIX_EPOCH)
        + std::time::Duration::from_millis(millis)
}

fn schema_snapshots(state: &Snapshots) -> Vec<schema::Snapshot> {
    state
        .0
        .iter()
        .enumerate()
        .filter_map(|(index, (key, value))| {
            let (name, time) = key.rsplit_once('@')?;
            let millis = time.strip_suffix("ms")?.parse().ok()?;
            Some(schema::Snapshot {
                index,
                name: Some(name.into()),
                value: value.clone(),
                time: schema_time(millis),
            })
        })
        .collect()
}

fn schema_formula(formula: &Formula<BrowserDomain>) -> schema::Formula {
    use schema::Formula as F;
    match formula {
        Formula::Pure { value, pretty } => F::Pure {
            value: *value,
            pretty: pretty.clone(),
        },
        Formula::Thunk { function, negated } => F::Thunk {
            function: function.pretty.clone(),
            negated: *negated,
        },
        Formula::And(left, right) => F::And(
            Box::new(schema_formula(left)),
            Box::new(schema_formula(right)),
        ),
        Formula::Or(left, right) => F::Or(
            Box::new(schema_formula(left)),
            Box::new(schema_formula(right)),
        ),
        Formula::Implies(left, right) => F::Implies(
            Box::new(schema_formula(left)),
            Box::new(schema_formula(right)),
        ),
        Formula::Next(child) => F::Next(Box::new(schema_formula(child))),
        Formula::Always(child, bound) => F::Always(
            Box::new(schema_formula(child)),
            bound.map(std::time::Duration::from_millis),
        ),
        Formula::Eventually(child, bound) => F::Eventually(
            Box::new(schema_formula(child)),
            bound.map(std::time::Duration::from_millis),
        ),
    }
}

fn schema_violation(violation: &Violation<BrowserDomain>) -> schema::Violation {
    use schema::Violation as V;
    match violation {
        Violation::False {
            time,
            condition,
            state,
        } => V::False {
            time: schema_time(*time),
            condition: condition.clone(),
            snapshots: schema_snapshots(state),
        },
        Violation::Eventually { subformula, reason } => V::Eventually {
            subformula: Box::new(schema_formula(subformula)),
            reason: match reason {
                bombadil_ltl::violation::EventuallyViolation::TimedOut(time) => {
                    schema::EventuallyViolation::TimedOut(schema_time(*time))
                }
                bombadil_ltl::violation::EventuallyViolation::TestEnded => {
                    schema::EventuallyViolation::TestEnded
                }
            },
        },
        Violation::Always {
            violation,
            subformula,
            start,
            end,
            time,
        } => V::Always {
            violation: Box::new(schema_violation(violation)),
            subformula: Box::new(schema_formula(subformula)),
            start: schema_time(*start),
            end: end.map(schema_time),
            time: schema_time(*time),
        },
        Violation::And { left, right } => V::And {
            left: Box::new(schema_violation(left)),
            right: Box::new(schema_violation(right)),
        },
        Violation::Or { left, right } => V::Or {
            left: Box::new(schema_violation(left)),
            right: Box::new(schema_violation(right)),
        },
        Violation::Implies { left, right, state } => V::Implies {
            left: schema_formula(left),
            right: Box::new(schema_violation(right)),
            antecedent_snapshots: schema_snapshots(state),
        },
    }
}

fn markup_json(tree: &markup::Markup, id: stdx::tree::NodeId) -> Value {
    use markup::Node;
    let node = &tree[id];
    match node.value() {
        Node::Text(text) => json!({"kind":"text", "text":text}),
        Node::Code(text) => json!({"kind":"code", "text":text}),
        Node::CodeBlock(text) => json!({"kind":"code-block", "text":text}),
        Node::Keyword(text) => json!({"kind":"keyword", "text":text}),
        Node::Time(time) => {
            json!({"kind":"time", "text":bombadil_schema::duration::format_duration(
                std::time::Duration::from_micros(time.as_micros()),
                bombadil_schema::duration::FormatDurationOptions { include_millis: true },
            )})
        }
        Node::SnapshotMarkup { name, value } => {
            json!({"kind":"snapshot", "name":name, "value":value})
        }
        Node::Comma => json!({"kind":"comma"}),
        Node::Join | Node::Snapshots => json!({
            "kind": if matches!(node.value(), Node::Join) { "join" } else { "snapshots" },
            "children": node.children().iter().map(|child| markup_json(tree, *child)).collect::<Vec<_>>(),
        }),
    }
}
fn describe(v: &Violation<BrowserDomain>) -> Value {
    match v {
        Violation::False {
            time,
            condition,
            state,
        } => json!({"kind":"predicate","time":time,"condition":condition,"observations":state.0}),
        Violation::Eventually { reason, .. } => {
            json!({"kind":"eventually","reason":format!("{reason:?}")})
        }
        Violation::Always {
            violation, time, ..
        } => json!({"kind":"always","time":time,"cause":describe(violation)}),
        Violation::And { left, right } => {
            json!({"kind":"and","left":describe(left),"right":describe(right)})
        }
        Violation::Or { left, right } => {
            json!({"kind":"or","left":describe(left),"right":describe(right)})
        }
        Violation::Implies { right, state, .. } => {
            json!({"kind":"implies","cause":describe(right),"observations":state.0})
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::*;
    use std::cell::RefCell;
    thread_local! { static RUN: RefCell<Run> = RefCell::new(Run::default()); }
    #[link(wasm_import_module = "host")]
    unsafe extern "C" {
        fn evaluate(id: u32) -> u64;
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn allocate(len: u32) -> u32 {
        Box::into_raw(vec![0u8; len as usize].into_boxed_slice()) as *mut u8 as u32
    }
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn deallocate(ptr: u32, len: u32) {
        unsafe {
            drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(
                ptr as *mut u8,
                len as usize,
            )));
        }
    }
    fn take(packed: u64) -> Result<Value, String> {
        let ptr = packed as u32;
        let len = (packed >> 32) as u32;
        let result = unsafe {
            serde_json::from_slice(std::slice::from_raw_parts(ptr as *const u8, len as usize))
                .map_err(|e| e.to_string())
        };
        unsafe {
            deallocate(ptr, len);
        }
        result
    }
    fn callback(
        predicate: &Predicate,
        negated: bool,
    ) -> Result<(Formula<BrowserDomain>, Snapshots), String> {
        let reply = take(unsafe { evaluate(predicate.id) })?;
        if let Some(error) = reply.get("error") {
            return Err(error.as_str().unwrap_or("Predicate error").to_string());
        }
        let wire: Wire =
            serde_json::from_value(reply["formula"].clone()).map_err(|e| e.to_string())?;
        let snapshots =
            serde_json::from_value(reply["observations"].clone()).map_err(|e| e.to_string())?;
        let syntax = wire.syntax();
        Ok((
            (if negated {
                Syntax::Not(Box::new(syntax))
            } else {
                syntax
            })
            .nnf(),
            Snapshots(snapshots),
        ))
    }
    #[unsafe(no_mangle)]
    pub extern "C" fn process(ptr: u32, len: u32) -> u64 {
        let request: Result<Value, _> = unsafe {
            serde_json::from_slice(std::slice::from_raw_parts(ptr as *const u8, len as usize))
        };
        let result = request.map_err(|e| e.to_string()).and_then(|request| {
            RUN.with(|cell| {
                let mut run = cell.borrow_mut();
                match request["kind"].as_str() {
                    Some("init") => {
                        let properties = serde_json::from_value(request["properties"].clone())
                            .map_err(|e| e.to_string())?;
                        run.init(properties);
                        Ok(json!({"ready":true}))
                    }
                    Some("step") => run.step(
                        request["time"].as_u64().ok_or("Invalid timestamp")?,
                        &mut callback,
                    ),
                    Some("dispose") => {
                        *run = Run::default();
                        Ok(json!({"disposed":true}))
                    }
                    _ => Err("Unknown runtime command".into()),
                }
            })
        });
        let reply = match result {
            Ok(value) => value,
            Err(error) => json!({"error":error}),
        };
        let bytes = serde_json::to_vec(&reply).unwrap().into_boxed_slice();
        let len = bytes.len() as u64;
        let ptr = Box::into_raw(bytes) as *mut u8 as u32;
        (len << 32) | u64::from(ptr)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn formula(text: Value) -> Wire {
        serde_json::from_value(text).unwrap()
    }
    #[test]
    fn invariant_retains_its_failure_time() {
        let mut run = Run::default();
        run.init(BTreeMap::from([(
            "invariant".into(),
            formula(json!({"op":"always","bound":null,"child":{"op":"thunk","id":0}})),
        )]));
        let mut value = true;
        let first = run
            .step(0, &mut |_, _| {
                Ok((
                    Formula::Pure {
                        value,
                        pretty: "count matches".into(),
                    },
                    Snapshots::default(),
                ))
            })
            .unwrap();
        assert_eq!(first["invariant"]["status"], "pending");
        value = false;
        let second = run
            .step(100, &mut |_, _| {
                Ok((
                    Formula::Pure {
                        value,
                        pretty: "count matches".into(),
                    },
                    Snapshots::default(),
                ))
            })
            .unwrap();
        assert_eq!(second["invariant"]["status"], "violation");
        assert_eq!(second["invariant"]["violation"]["cause"]["time"], 100);
    }
    #[test]
    fn vacuous_transitions_keep_bounded_obligations_and_detect_later_failures() {
        let mut run = Run::default();
        run.init(BTreeMap::from([(
            "transition".into(),
            formula(json!({
                "op": "always", "bound": null,
                "child": {
                    "op": "implies",
                    "left": {"op": "thunk", "id": 0},
                    "right": {"op": "next", "child": {"op": "thunk", "id": 1}},
                },
            })),
        )]));
        // Trigger one next-state obligation, then leave the antecedent false.
        // Older evaluators duplicated the outer always obligation on every step.
        for time in 0..=1000 {
            let result = run
                .step(time, &mut |predicate, _| {
                    Ok((
                        Formula::Pure {
                            value: predicate.id == 1 || time == 0,
                            pretty: "transition condition".into(),
                        },
                        Snapshots::default(),
                    ))
                })
                .unwrap();
            assert_eq!(result["transition"]["status"], "pending");
            let Some(Evaluation::Residual(residual)) = &run.properties["transition"].value else {
                panic!("Expected an unfinished invariant");
            };
            assert!(
                residual.size().nodes <= 8,
                "Obligations grew at step {time}"
            );
        }
        // A newly triggered obligation must still fail at the following step.
        for time in 1001..=1002 {
            let result = run
                .step(time, &mut |_, _| {
                    Ok((
                        Formula::Pure {
                            value: time == 1001,
                            pretty: "transition condition".into(),
                        },
                        Snapshots::default(),
                    ))
                })
                .unwrap();
            assert_eq!(
                result["transition"]["status"],
                if time == 1001 { "pending" } else { "violation" },
            );
        }
    }
    #[test]
    fn timestamps_cannot_go_backward() {
        let mut run = Run::default();
        run.step(10, &mut |_, _| unreachable!()).unwrap();
        assert!(run.step(9, &mut |_, _| unreachable!()).is_err());
    }
}
