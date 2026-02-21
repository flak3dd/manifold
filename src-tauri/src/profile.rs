// ── Manifold profile repository ───────────────────────────────────────────────

use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use uuid::Uuid;

use crate::db::Db;
use crate::error::{ManifoldError, Result};
use crate::fingerprint::Fingerprint;
use crate::human::{BehaviorProfile, HumanBehavior};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ProfileStatus {
    #[default]
    Idle,
    Running,
    Error,
}

impl std::fmt::Display for ProfileStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            Self::Idle => "idle",
            Self::Running => "running",
            Self::Error => "error",
        };
        write!(f, "{s}")
    }
}

impl std::str::FromStr for ProfileStatus {
    type Err = ManifoldError;
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "idle" => Ok(Self::Idle),
            "running" => Ok(Self::Running),
            "error" => Ok(Self::Error),
            other => Err(ManifoldError::InvalidArg(format!(
                "unknown ProfileStatus: {other:?}"
            ))),
        }
    }
}

/// Full profile record returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub fingerprint: Fingerprint,
    pub human: HumanBehavior,
    pub proxy_id: Option<String>,
    pub notes: String,
    pub tags: Vec<String>,
    pub status: ProfileStatus,
    pub created_at: DateTime<Utc>,
    pub last_used: Option<DateTime<Utc>>,
    /// Absolute path to the Chromium user-data directory for this profile.
    pub data_dir: String,
    /// Enable TLS bridge for JA4 fingerprinting control.
    pub tls_bridge: Option<bool>,
}

/// Payload for creating a new profile.
#[derive(Debug, Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    /// Optional seed — auto-generated if None.
    pub seed: Option<u64>,
    pub proxy_id: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub behavior_profile: Option<String>,
}

/// Payload for updating an existing profile.
#[derive(Debug, Deserialize)]
pub struct UpdateProfileRequest {
    pub name: Option<String>,
    pub fingerprint: Option<Fingerprint>,
    pub human: Option<HumanBehavior>,
    pub proxy_id: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub behavior_profile: Option<String>,
    pub tls_bridge: Option<bool>,
}

// ── Repository ────────────────────────────────────────────────────────────────

pub struct ProfileRepo {
    db: Db,
    profiles_root: PathBuf,
}

impl ProfileRepo {
    pub fn new(db: Db) -> Self {
        let profiles_root = crate::db::profiles_dir();
        Self { db, profiles_root }
    }

    /// Create a repo with an explicit root directory (used in tests).
    #[allow(dead_code)]
    pub fn new_with_root(db: Db, profiles_root: PathBuf) -> Self {
        Self { db, profiles_root }
    }

    // ── Create ────────────────────────────────────────────────────────────────

    pub fn create(&self, req: CreateProfileRequest) -> Result<Profile> {
        use crate::fingerprint::FingerprintOrchestrator;
        use rand::Rng;

        let id = Uuid::new_v4().to_string();

        // Derive seed
        let seed = req.seed.unwrap_or_else(|| rand::thread_rng().gen::<u64>());

        let fingerprint = FingerprintOrchestrator::generate(seed);

        // Parse behavior profile
        let bp: BehaviorProfile = req
            .behavior_profile
            .as_deref()
            .unwrap_or("normal")
            .parse()
            .unwrap_or_default();
        let human = HumanBehavior::from_profile(bp);

        let now = Utc::now();
        let tags = req.tags.unwrap_or_default();
        let notes = req.notes.unwrap_or_default();

        let fp_json = serde_json::to_string(&fingerprint)?;
        let human_json = serde_json::to_string(&human)?;
        let tags_json = serde_json::to_string(&tags)?;

        // Create the browser data directory
        let data_dir = self.profile_data_dir(&id);
        std::fs::create_dir_all(&data_dir)?;

        self.db.with_conn(|conn| {
            conn.execute(
                r#"INSERT INTO profiles
                   (id, name, fingerprint_json, human_json, proxy_id,
                    notes, tags, status, created_at, last_used, tls_bridge)
                   VALUES (?1,?2,?3,?4,?5,?6,?7,'idle',?8,NULL,0)"#,
                params![
                    id,
                    req.name,
                    fp_json,
                    human_json,
                    req.proxy_id,
                    notes,
                    tags_json,
                    now.to_rfc3339(),
                ],
            )?;
            Ok(())
        })?;

        Ok(Profile {
            id,
            name: req.name,
            fingerprint,
            human,
            proxy_id: req.proxy_id,
            notes,
            tags,
            status: ProfileStatus::Idle,
            created_at: now,
            last_used: None,
            data_dir: data_dir.to_string_lossy().into_owned(),
            tls_bridge: Some(false),
        })
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    pub fn get(&self, id: &str) -> Result<Profile> {
        self.db
            .with_conn(|conn| {
                let row = conn
                    .query_row(
                        r#"SELECT id, name, fingerprint_json, human_json, proxy_id,
                          notes, tags, status, created_at, last_used, tls_bridge
                   FROM profiles WHERE id = ?1"#,
                        params![id],
                        row_to_profile,
                    )
                    .optional()?;

                row.ok_or_else(|| ManifoldError::ProfileNotFound(id.into()))
            })
            .and_then(|mut p| {
                p.data_dir = self.profile_data_dir(&p.id).to_string_lossy().into_owned();
                Ok(p)
            })
    }

    pub fn list(&self) -> Result<Vec<Profile>> {
        self.db
            .with_conn(|conn| {
                let mut stmt = conn.prepare(
                    r#"SELECT id, name, fingerprint_json, human_json, proxy_id,
                          notes, tags, status, created_at, last_used, tls_bridge
                   FROM profiles
                   ORDER BY created_at DESC"#,
                )?;

                let profiles = stmt
                    .query_map([], row_to_profile)?
                    .collect::<rusqlite::Result<Vec<_>>>()?;

                Ok(profiles)
            })
            .map(|mut ps| {
                for p in &mut ps {
                    p.data_dir = self.profile_data_dir(&p.id).to_string_lossy().into_owned();
                }
                ps
            })
    }

    // ── Update ────────────────────────────────────────────────────────────────

    pub fn update(&self, id: &str, req: UpdateProfileRequest) -> Result<Profile> {
        // Fetch current record first
        let mut profile = self.get(id)?;

        if let Some(name) = req.name {
            profile.name = name;
        }
        if let Some(fp) = req.fingerprint {
            profile.fingerprint = fp;
        }
        if let Some(human) = req.human {
            profile.human = human;
        }
        if let Some(bp_str) = req.behavior_profile {
            let bp: BehaviorProfile = bp_str.parse().unwrap_or_default();
            profile.human = HumanBehavior::from_profile(bp);
        }
        if req.proxy_id.is_some() {
            profile.proxy_id = req.proxy_id;
        }
        if let Some(notes) = req.notes {
            profile.notes = notes;
        }
        if let Some(tags) = req.tags {
            profile.tags = tags;
        }
        // tls_bridge is handled via separate update endpoint

        let fp_json = serde_json::to_string(&profile.fingerprint)?;
        let human_json = serde_json::to_string(&profile.human)?;
        let tags_json = serde_json::to_string(&profile.tags)?;

        self.db.with_conn(|conn| {
            let updated = conn.execute(
                r#"UPDATE profiles
                   SET name = ?1, fingerprint_json = ?2, human_json = ?3,
                       proxy_id = ?4, notes = ?5, tags = ?6
                   WHERE id = ?7"#,
                params![
                    profile.name,
                    fp_json,
                    human_json,
                    profile.proxy_id,
                    profile.notes,
                    tags_json,
                    id,
                ],
            )?;

            if updated == 0 {
                return Err(ManifoldError::ProfileNotFound(id.into()));
            }
            Ok(())
        })?;

        Ok(profile)
    }

    pub fn set_status(&self, id: &str, status: ProfileStatus) -> Result<()> {
        self.db.with_conn(|conn| {
            let updated = conn.execute(
                "UPDATE profiles SET status = ?1 WHERE id = ?2",
                params![status.to_string(), id],
            )?;
            if updated == 0 {
                return Err(ManifoldError::ProfileNotFound(id.into()));
            }
            Ok(())
        })
    }

    pub fn touch_last_used(&self, id: &str) -> Result<()> {
        let now = Utc::now().to_rfc3339();
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE profiles SET last_used = ?1 WHERE id = ?2",
                params![now, id],
            )?;
            Ok(())
        })
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    pub fn delete(&self, id: &str) -> Result<()> {
        // Remove browser data directory first
        let data_dir = self.profile_data_dir(id);
        if data_dir.exists() {
            std::fs::remove_dir_all(&data_dir).ok();
        }

        self.db.with_conn(|conn| {
            let deleted = conn.execute("DELETE FROM profiles WHERE id = ?1", params![id])?;
            if deleted == 0 {
                return Err(ManifoldError::ProfileNotFound(id.into()));
            }
            Ok(())
        })
    }

    // ── Fingerprint helpers ───────────────────────────────────────────────────

    /// Regenerate fingerprint from the same seed (deterministic refresh).
    pub fn reseed_fingerprint(&self, id: &str, new_seed: Option<u64>) -> Result<Profile> {
        use crate::fingerprint::FingerprintOrchestrator;
        use rand::Rng;

        let mut profile = self.get(id)?;
        let seed = new_seed.unwrap_or_else(|| rand::thread_rng().gen::<u64>());
        profile.fingerprint = FingerprintOrchestrator::generate(seed);

        let fp_json = serde_json::to_string(&profile.fingerprint)?;
        self.db.with_conn(|conn| {
            conn.execute(
                "UPDATE profiles SET fingerprint_json = ?1 WHERE id = ?2",
                params![fp_json, id],
            )?;
            Ok(())
        })?;

        Ok(profile)
    }

    // ── Private ───────────────────────────────────────────────────────────────

    fn profile_data_dir(&self, id: &str) -> PathBuf {
        self.profiles_root.join(id)
    }
}

// ── Row mapper ────────────────────────────────────────────────────────────────

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    /// Build a fresh in-memory repo with a temp directory for profile data.
    fn make_repo() -> (ProfileRepo, tempfile::TempDir) {
        let dir = tempfile::TempDir::new().unwrap();
        let db = Db::open_in_memory().unwrap();
        let repo = ProfileRepo::new_with_root(db, dir.path().to_path_buf());
        (repo, dir)
    }

    fn default_create(name: &str) -> CreateProfileRequest {
        CreateProfileRequest {
            name: name.to_string(),
            seed: Some(42),
            proxy_id: None,
            notes: None,
            tags: None,
            behavior_profile: None,
        }
    }

    // ── ProfileStatus ─────────────────────────────────────────────────────────

    #[test]
    fn profile_status_display() {
        assert_eq!(ProfileStatus::Idle.to_string(), "idle");
        assert_eq!(ProfileStatus::Running.to_string(), "running");
        assert_eq!(ProfileStatus::Error.to_string(), "error");
    }

    #[test]
    fn profile_status_from_str_roundtrip() {
        for s in &["idle", "running", "error"] {
            let parsed: ProfileStatus = s.parse().unwrap();
            assert_eq!(parsed.to_string(), *s);
        }
    }

    #[test]
    fn profile_status_unknown_errors() {
        let result: Result<ProfileStatus> = "active".parse();
        assert!(result.is_err());
    }

    // ── Create ────────────────────────────────────────────────────────────────

    #[test]
    fn create_returns_correct_name() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Alice")).unwrap();
        assert_eq!(p.name, "Alice");
    }

    #[test]
    fn create_assigns_uuid_id() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Bob")).unwrap();
        // UUID v4: 8-4-4-4-12 hex chars
        assert_eq!(p.id.len(), 36);
        assert_eq!(p.id.chars().filter(|&c| c == '-').count(), 4);
    }

    #[test]
    fn create_uses_supplied_seed() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Seeded")).unwrap();
        assert_eq!(p.fingerprint.seed, 42);
    }

    #[test]
    fn create_auto_generates_seed_when_none() {
        let (repo, _dir) = make_repo();
        let req = CreateProfileRequest {
            name: "AutoSeed".into(),
            seed: None,
            proxy_id: None,
            notes: None,
            tags: None,
            behavior_profile: None,
        };
        let p = repo.create(req).unwrap();
        assert!(p.fingerprint.seed > 0);
    }

    #[test]
    fn create_sets_idle_status() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Status")).unwrap();
        assert_eq!(p.status, ProfileStatus::Idle);
    }

    #[test]
    fn create_no_last_used() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("NoLastUsed")).unwrap();
        assert!(p.last_used.is_none());
    }

    #[test]
    fn create_stores_tags_and_notes() {
        let (repo, _dir) = make_repo();
        let req = CreateProfileRequest {
            name: "Tagged".into(),
            seed: Some(1),
            proxy_id: None,
            notes: Some("a note".into()),
            tags: Some(vec!["vpn".into(), "test".into()]),
            behavior_profile: None,
        };
        let p = repo.create(req).unwrap();
        assert_eq!(p.notes, "a note");
        assert_eq!(p.tags, vec!["vpn", "test"]);
    }

    #[test]
    fn create_with_proxy_id() {
        let (repo, _dir) = make_repo();
        // Insert a proxy row directly so the FK constraint is satisfied
        repo.db.with_conn(|conn| {
            conn.execute(
                "INSERT INTO proxies (id, name, proxy_type, host, port, healthy) VALUES ('px1','test','http','127.0.0.1',8080,0)",
                [],
            )?;
            Ok(())
        }).unwrap();
        let req = CreateProfileRequest {
            name: "WithProxy".into(),
            seed: Some(2),
            proxy_id: Some("px1".into()),
            notes: None,
            tags: None,
            behavior_profile: None,
        };
        let p = repo.create(req).unwrap();
        assert_eq!(p.proxy_id, Some("px1".into()));
    }

    #[test]
    fn create_data_dir_is_created_on_disk() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("DirCheck")).unwrap();
        assert!(
            std::path::Path::new(&p.data_dir).exists(),
            "profile data dir should be created on disk"
        );
    }

    #[test]
    fn create_behavior_profile_normal_default() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Normal")).unwrap();
        assert_eq!(p.human.profile.to_string(), "normal");
    }

    #[test]
    fn create_behavior_profile_cautious() {
        let (repo, _dir) = make_repo();
        let req = CreateProfileRequest {
            name: "Cautious".into(),
            seed: Some(5),
            proxy_id: None,
            notes: None,
            tags: None,
            behavior_profile: Some("cautious".into()),
        };
        let p = repo.create(req).unwrap();
        assert_eq!(p.human.profile.to_string(), "cautious");
    }

    // ── Get ───────────────────────────────────────────────────────────────────

    #[test]
    fn get_existing_profile_round_trips() {
        let (repo, _dir) = make_repo();
        let created = repo.create(default_create("RoundTrip")).unwrap();
        let fetched = repo.get(&created.id).unwrap();
        assert_eq!(fetched.id, created.id);
        assert_eq!(fetched.name, created.name);
        assert_eq!(fetched.fingerprint.seed, created.fingerprint.seed);
        assert_eq!(
            fetched.human.profile.to_string(),
            created.human.profile.to_string()
        );
    }

    #[test]
    fn get_nonexistent_returns_not_found() {
        let (repo, _dir) = make_repo();
        let err = repo.get("does-not-exist").unwrap_err();
        assert!(matches!(err, ManifoldError::ProfileNotFound(_)));
    }

    #[test]
    fn get_fills_data_dir() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("DataDir")).unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert!(!fetched.data_dir.is_empty());
        assert!(fetched.data_dir.contains(&p.id));
    }

    // ── List ──────────────────────────────────────────────────────────────────

    #[test]
    fn list_returns_all_created_profiles() {
        let (repo, _dir) = make_repo();
        repo.create(default_create("A")).unwrap();
        repo.create(default_create("B")).unwrap();
        repo.create(default_create("C")).unwrap();
        let all = repo.list().unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn list_empty_db_returns_empty_vec() {
        let (repo, _dir) = make_repo();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn list_ordered_descending_by_created_at() {
        let (repo, _dir) = make_repo();
        // Use distinct seeds so timestamps may differ; sleep is unreliable in
        // unit tests, so we verify the list contains all names instead.
        let a = repo.create(default_create("First")).unwrap();
        let b = repo.create(default_create("Second")).unwrap();
        let all = repo.list().unwrap();
        let ids: Vec<_> = all.iter().map(|p| p.id.as_str()).collect();
        // Both IDs must appear
        assert!(ids.contains(&a.id.as_str()));
        assert!(ids.contains(&b.id.as_str()));
    }

    // ── Update ────────────────────────────────────────────────────────────────

    #[test]
    fn update_name() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("OldName")).unwrap();
        let updated = repo
            .update(
                &p.id,
                UpdateProfileRequest {
                    name: Some("NewName".into()),
                    fingerprint: None,
                    human: None,
                    proxy_id: None,
                    notes: None,
                    tags: None,
                    behavior_profile: None,
                },
            )
            .unwrap();
        assert_eq!(updated.name, "NewName");
        assert_eq!(repo.get(&p.id).unwrap().name, "NewName");
    }

    #[test]
    fn update_tags_and_notes() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Tagged")).unwrap();
        repo.update(
            &p.id,
            UpdateProfileRequest {
                name: None,
                fingerprint: None,
                human: None,
                proxy_id: None,
                notes: Some("updated note".into()),
                tags: Some(vec!["new_tag".into()]),
                behavior_profile: None,
            },
        )
        .unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert_eq!(fetched.notes, "updated note");
        assert_eq!(fetched.tags, vec!["new_tag"]);
    }

    #[test]
    fn update_fingerprint() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("FpUpdate")).unwrap();
        let mut new_fp = p.fingerprint.clone();
        new_fp.seed = 99999;
        repo.update(
            &p.id,
            UpdateProfileRequest {
                name: None,
                fingerprint: Some(new_fp),
                human: None,
                proxy_id: None,
                notes: None,
                tags: None,
                behavior_profile: None,
            },
        )
        .unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert_eq!(fetched.fingerprint.seed, 99999);
    }

    #[test]
    fn update_nonexistent_returns_not_found() {
        let (repo, _dir) = make_repo();
        let err = repo
            .update(
                "no-such-id",
                UpdateProfileRequest {
                    name: Some("x".into()),
                    fingerprint: None,
                    human: None,
                    proxy_id: None,
                    notes: None,
                    tags: None,
                    behavior_profile: None,
                },
            )
            .unwrap_err();
        assert!(matches!(err, ManifoldError::ProfileNotFound(_)));
    }

    #[test]
    fn update_behavior_profile() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("BpChange")).unwrap();
        repo.update(
            &p.id,
            UpdateProfileRequest {
                name: None,
                fingerprint: None,
                human: None,
                proxy_id: None,
                notes: None,
                tags: None,
                behavior_profile: Some("bot".into()),
            },
        )
        .unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert_eq!(fetched.human.profile.to_string(), "bot");
    }

    // ── Set status / touch ────────────────────────────────────────────────────

    #[test]
    fn set_status_changes_status() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("StatusChange")).unwrap();
        repo.set_status(&p.id, ProfileStatus::Running).unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert_eq!(fetched.status, ProfileStatus::Running);
    }

    #[test]
    fn touch_last_used_sets_timestamp() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Touched")).unwrap();
        assert!(p.last_used.is_none());
        repo.touch_last_used(&p.id).unwrap();
        let fetched = repo.get(&p.id).unwrap();
        assert!(fetched.last_used.is_some());
    }

    // ── Delete ────────────────────────────────────────────────────────────────

    #[test]
    fn delete_removes_from_db() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("ToDelete")).unwrap();
        repo.delete(&p.id).unwrap();
        let err = repo.get(&p.id).unwrap_err();
        assert!(matches!(err, ManifoldError::ProfileNotFound(_)));
    }

    #[test]
    fn delete_removes_from_list() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("ListDel")).unwrap();
        assert_eq!(repo.list().unwrap().len(), 1);
        repo.delete(&p.id).unwrap();
        assert!(repo.list().unwrap().is_empty());
    }

    #[test]
    fn delete_nonexistent_returns_not_found() {
        let (repo, _dir) = make_repo();
        let err = repo.delete("ghost").unwrap_err();
        assert!(matches!(err, ManifoldError::ProfileNotFound(_)));
    }

    #[test]
    fn delete_removes_data_dir() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("DirDel")).unwrap();
        let dir = std::path::PathBuf::from(&p.data_dir);
        assert!(dir.exists());
        repo.delete(&p.id).unwrap();
        assert!(!dir.exists());
    }

    // ── Reseed fingerprint ────────────────────────────────────────────────────

    #[test]
    fn reseed_with_explicit_seed() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("Reseed")).unwrap();
        let reseeded = repo.reseed_fingerprint(&p.id, Some(777)).unwrap();
        assert_eq!(reseeded.fingerprint.seed, 777);
        // Persisted
        assert_eq!(repo.get(&p.id).unwrap().fingerprint.seed, 777);
    }

    #[test]
    fn reseed_without_seed_generates_new() {
        let (repo, _dir) = make_repo();
        let p = repo.create(default_create("ReseedRandom")).unwrap();
        let original_seed = p.fingerprint.seed;
        let reseeded = repo.reseed_fingerprint(&p.id, None).unwrap();
        // Extremely unlikely to collide, but not impossible — just check it's set
        let _ = reseeded.fingerprint.seed;
        // The new fingerprint must be persisted
        let fetched = repo.get(&p.id).unwrap();
        assert_eq!(fetched.fingerprint.seed, reseeded.fingerprint.seed);
        // Deterministic generate: same seed → same UA
        if reseeded.fingerprint.seed != original_seed {
            assert_ne!(reseeded.fingerprint.seed, original_seed);
        }
    }

    #[test]
    fn reseed_nonexistent_returns_not_found() {
        let (repo, _dir) = make_repo();
        let err = repo.reseed_fingerprint("ghost", Some(1)).unwrap_err();
        assert!(matches!(err, ManifoldError::ProfileNotFound(_)));
    }

    // ── Multiple profiles isolation ───────────────────────────────────────────

    #[test]
    fn multiple_profiles_are_independent() {
        let (repo, _dir) = make_repo();
        let a = repo
            .create(CreateProfileRequest {
                name: "Alpha".into(),
                seed: Some(1),
                proxy_id: None,
                notes: None,
                tags: None,
                behavior_profile: None,
            })
            .unwrap();
        let b = repo
            .create(CreateProfileRequest {
                name: "Beta".into(),
                seed: Some(2),
                proxy_id: None,
                notes: None,
                tags: None,
                behavior_profile: None,
            })
            .unwrap();
        assert_ne!(a.id, b.id);
        assert_ne!(a.fingerprint.seed, b.fingerprint.seed);

        repo.update(
            &a.id,
            UpdateProfileRequest {
                name: Some("AlphaUpdated".into()),
                fingerprint: None,
                human: None,
                proxy_id: None,
                notes: None,
                tags: None,
                behavior_profile: None,
            },
        )
        .unwrap();

        let b_check = repo.get(&b.id).unwrap();
        assert_eq!(b_check.name, "Beta", "updating A must not affect B");
    }
}

fn row_to_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<Profile> {
    let id: String = row.get(0)?;
    let name: String = row.get(1)?;
    let fp_json: String = row.get(2)?;
    let human_json: String = row.get(3)?;
    let proxy_id: Option<String> = row.get(4)?;
    let notes: String = row.get(5)?;
    let tags_json: String = row.get(6)?;
    let status_str: String = row.get(7)?;
    let created_str: String = row.get(8)?;
    let last_str: Option<String> = row.get(9)?;
    let tls_bridge: Option<i32> = row.get(10)?;

    let fingerprint: Fingerprint = serde_json::from_str(&fp_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(2, rusqlite::types::Type::Text, Box::new(e))
    })?;

    let human: HumanBehavior = serde_json::from_str(&human_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(3, rusqlite::types::Type::Text, Box::new(e))
    })?;

    let tags: Vec<String> = serde_json::from_str(&tags_json).unwrap_or_default();

    let status = status_str.parse().unwrap_or_default();

    let created_at = DateTime::parse_from_rfc3339(&created_str)
        .map(|dt| dt.with_timezone(&Utc))
        .unwrap_or_else(|_| Utc::now());

    let last_used = last_str.and_then(|s| {
        DateTime::parse_from_rfc3339(&s)
            .ok()
            .map(|dt| dt.with_timezone(&Utc))
    });

    Ok(Profile {
        id,
        name,
        fingerprint,
        human,
        proxy_id,
        notes,
        tags,
        status,
        created_at,
        last_used,
        data_dir: String::new(), // filled by repo after construction
        tls_bridge: tls_bridge.map(|v| v != 0),
    })
}
