use crate::types::TargetName;
use serde_json::{json, Value};
use std::fmt;

#[derive(Debug)]
pub struct OperationFailure {
    pub report: Value,
}

impl fmt::Display for OperationFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let message = self.report["error"]["message"]
            .as_str()
            .unwrap_or("Operation failed");
        write!(f, "{message}")?;
        if let Some(results) = self.report["results"].as_array() {
            for item in results {
                if item["status"] == "failed" {
                    write!(
                        f,
                        "; {}: {}",
                        item["target"].as_str().unwrap_or("operation"),
                        item["error"]["message"].as_str().unwrap_or("failed")
                    )?;
                }
            }
        }
        Ok(())
    }
}
impl std::error::Error for OperationFailure {}

pub struct OperationReport {
    operation: String,
    resource: String,
    results: Vec<Value>,
}

impl OperationReport {
    pub fn new(operation: &str, resource: &str) -> Self {
        Self {
            operation: operation.into(),
            resource: resource.into(),
            results: Vec::new(),
        }
    }

    pub fn push(&mut self, target: TargetName, result: anyhow::Result<Value>) {
        self.results.push(match result {
            Ok(detail) => json!({"target":target,"resource":self.resource,"status":"success","detail":detail}),
            Err(error) => {
                let mut item = json!({"target":target,"resource":self.resource,"status":"failed","error":{"code":error_code(&error),"message":redact_text(&format!("{error:#}"))}});
                if let Some(failure) = error.downcast_ref::<OperationFailure>() {
                    item["detail"] = failure.report.clone();
                }
                item
            }
        });
    }

    pub fn finish(self) -> anyhow::Result<Value> {
        let retry: Vec<_> = self
            .results
            .iter()
            .filter(|item| item["status"] == "failed")
            .map(|item| item["target"].clone())
            .collect();
        let ok = retry.is_empty();
        let mut report = json!({"ok":ok,"operation":self.operation,"resource":self.resource,"results":self.results,"retryTargets":retry});
        if !ok {
            report["error"] = json!({"code":"operation_failed","message":"One or more targets failed; successful targets were retained"});
            return Err(OperationFailure { report }.into());
        }
        Ok(report)
    }
}

pub fn error_code(error: &anyhow::Error) -> &'static str {
    if error.downcast_ref::<OperationFailure>().is_some() {
        return "operation_failed";
    }
    let message = error.to_string().to_lowercase();
    if message.contains("conflict")
        || message.contains("modified")
        || message.contains("local edit")
    {
        "conflict"
    } else if message.contains("not found") || message.contains("does not exist") {
        "not_found"
    } else if message.contains("permission") {
        "permission_denied"
    } else if message.contains("timed out") || message.contains("timeout") {
        "timeout"
    } else {
        "operation_failed"
    }
}

pub fn redact_text(text: &str) -> String {
    use std::sync::OnceLock;
    static PATTERNS: OnceLock<Vec<regex::Regex>> = OnceLock::new();
    let text = if let Ok(value) = serde_json::from_str::<Value>(text) {
        if value.is_object() || value.is_array() {
            redact_value(&value).to_string()
        } else {
            text.to_owned()
        }
    } else {
        text.to_owned()
    };
    let patterns = PATTERNS.get_or_init(|| [
        r#"(?is)["']?(?:env|headers)["']?\s*[:=]\s*\{[^}]*\}"#,
        r"(?i)(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{16,}|github_pat_[a-z0-9_]{16,}|npm_[a-z0-9]{16,}|AKIA[A-Z0-9]{16})",
        r#"(?i)(?:bearer\s+)[^\s"']+"#,
        r#"(?i)["']?(?:token|password|secret|api[_-]?key|authorization|access[_-]?token|client[_-]?secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;}]+)"#,
        r#"(?i)--(?:token|password|secret|api[_-]?key|authorization|access[_-]?token|client[_-]?secret)\s+(?:"[^"]*"|'[^']*'|[^\s]+)"#,
        r"(?i)https?://[^\s/]+:[^\s/@]+@",
    ].iter().map(|pattern| regex::Regex::new(pattern).expect("redaction expression")).collect());
    patterns.iter().fold(text, |result, pattern| {
        pattern.replace_all(&result, "[REDACTED]").into_owned()
    })
}

pub fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(fields) => Value::Object(
            fields
                .iter()
                .map(|(key, value)| {
                    let lower: String = key
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect();
                    let protected = lower == "env" || lower == "headers" || sensitive_name(&lower);
                    (
                        key.clone(),
                        if protected {
                            json!("[REDACTED]")
                        } else {
                            redact_value(value)
                        },
                    )
                })
                .collect(),
        ),
        Value::Array(values) => {
            let mut hide_next = false;
            Value::Array(
                values
                    .iter()
                    .map(|value| {
                        if hide_next {
                            hide_next = false;
                            return json!("[REDACTED]");
                        }
                        if let Some(text) = value.as_str() {
                            if text.starts_with('-')
                                && !text.contains('=')
                                && sensitive_name(
                                    &text
                                        .chars()
                                        .filter(|c| c.is_alphanumeric())
                                        .flat_map(char::to_lowercase)
                                        .collect::<String>(),
                                )
                            {
                                hide_next = true;
                                return json!(text);
                            }
                        }
                        redact_value(value)
                    })
                    .collect(),
            )
        }
        Value::String(text) => json!(redact_text(text)),
        _ => value.clone(),
    }
}

fn sensitive_name(name: &str) -> bool {
    [
        "token",
        "secret",
        "password",
        "authorization",
        "apikey",
        "credential",
    ]
    .iter()
    .any(|field| name.contains(field))
}

pub fn collect_resources(
    operation: &str,
    ids: &[String],
    mut action: impl FnMut(&str) -> anyhow::Result<Value>,
) -> anyhow::Result<Value> {
    let mut values = Vec::new();
    let mut results = Vec::new();
    let mut retry_resources = Vec::new();
    let mut retry_targets = std::collections::BTreeSet::new();
    for id in ids {
        match action(id) {
            Ok(value) => {
                results.push(json!({"resource":id,"status":"success","detail":value}));
                values.push(value);
            }
            Err(error) => {
                retry_resources.push(id.clone());
                let detail = error
                    .downcast_ref::<OperationFailure>()
                    .map(|failure| failure.report.clone())
                    .unwrap_or(Value::Null);
                for target in detail["retryTargets"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                {
                    retry_targets.insert(target.to_owned());
                }
                results.push(json!({"resource":id,"status":"failed","error":{"code":error_code(&error),"message":redact_text(&format!("{error:#}"))},"detail":detail}));
            }
        }
    }
    if !retry_resources.is_empty() {
        return Err(OperationFailure{report:json!({"ok":false,"operation":operation,"results":results,"retryResources":retry_resources,"retryTargets":retry_targets,"error":{"code":"operation_failed","message":"One or more resources failed; successful resources were retained"}})}.into());
    }
    Ok(json!(values))
}

pub fn redact_command_output(text: &str, args: &[String]) -> String {
    fn collect(value: &Value, protected: bool, secrets: &mut Vec<String>) {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields {
                    let name = key
                        .chars()
                        .filter(|c| c.is_alphanumeric())
                        .flat_map(char::to_lowercase)
                        .collect::<String>();
                    collect(
                        value,
                        protected || name == "env" || name == "headers" || sensitive_name(&name),
                        secrets,
                    );
                }
            }
            Value::Array(values) => {
                let mut next = false;
                for value in values {
                    collect(value, protected || next, secrets);
                    next = value.as_str().is_some_and(|value| {
                        value.starts_with('-') && sensitive_name(&value.to_lowercase())
                    });
                }
            }
            Value::String(value) if protected && !value.is_empty() => secrets.push(value.clone()),
            _ => {}
        }
    }
    let mut secrets = Vec::new();
    let mut next = false;
    for arg in args {
        if next && !arg.is_empty() {
            secrets.push(arg.clone());
        }
        next = arg.starts_with('-') && sensitive_name(&arg.to_lowercase());
        if let Ok(value) = serde_json::from_str::<Value>(arg) {
            collect(&value, false, &mut secrets);
        }
        if next {
            if let Some((_, value)) = arg.split_once('=') {
                if !value.is_empty() {
                    secrets.push(value.to_owned());
                }
                next = false;
            }
        }
    }
    secrets.sort_by_key(|secret| std::cmp::Reverse(secret.len()));
    let mut result = text.to_owned();
    for secret in secrets {
        // Providers commonly echo the serialized request, including escaped newlines/quotes.
        let encoded = serde_json::to_string(&secret).expect("string serialization");
        result = result.replace(&encoded[1..encoded.len() - 1], "[REDACTED]");
        result = result.replace(&secret, "[REDACTED]");
    }
    redact_text(&result)
}
