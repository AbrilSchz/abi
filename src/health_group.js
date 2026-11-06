import { DEFAULT_HEALTH, DEFAULT_MEMBER, deriveHRMax } from './health_defaults.js';
import { advanceMemberState, initMemberState } from './health.js';

const STORAGE_KEY_MODE = 'marswalk_health_mode';

export function resolveHealthConfig(overrides = {}) {
    const merged = { ...DEFAULT_HEALTH, ...overrides };
    if (merged.route_weights) merged.route_weights = { ...DEFAULT_HEALTH.route_weights, ...overrides.route_weights };
    if (merged.hr_max_bpm == null) merged.hr_max_bpm = deriveHRMax(merged.age_years);
    return merged;
}

function resolveMember(m, cfg, index) {
    const member = { ...DEFAULT_MEMBER, ...m, id: m.id || `member_${index}` };
    if (member.hr_max_bpm == null) member.hr_max_bpm = deriveHRMax(member.age_years);
    if (member.o2_capacity_l_equiv == null) member.o2_capacity_l_equiv = cfg.o2_capacity_l_equiv;
    return member;
}

export function createSoloHealth(configOverrides = {}, memberOverrides = {}) {
    const cfg = resolveHealthConfig(configOverrides);
    const member = resolveMember({ ...memberOverrides, id: memberOverrides.id || 'solo' }, cfg, 0);
    return {
        mode: 'solo', cfg,
        members: [{ ...member, ...initMemberState(member, cfg) }],
        leaderIndex: 0, rotationClockMin: 0, totalRotations: 0,
        formation: 'solo', resourceTopology: 'per_suit',
    };
}

export function createGroupHealth(memberOverridesList = [], configOverrides = {}) {
    const cfg = resolveHealthConfig(configOverrides);
    const list = memberOverridesList.length
        ? memberOverridesList
        : Array.from({ length: cfg.group_size }, (_, i) => ({ id: `member_${i}` }));
    const members = list.map((m, i) => {
        const member = resolveMember(m, cfg, i);
        return { ...member, ...initMemberState(member, cfg) };
    });
    return {
        mode: 'group', cfg, members,
        leaderIndex: 0, rotationClockMin: 0, totalRotations: 0,
        formation: cfg.formation, resourceTopology: cfg.resource_topology,
    };
}

function ema(prev, next, alpha) {
    if (prev == null || !Number.isFinite(prev)) return next;
    return prev * (1 - alpha) + next * alpha;
}

export function advanceGroupState(health, segment) {
    const cfg = health.cfg;
    const isGroup = health.mode === 'group';
    const t_min = (segment.walking_time_h || 0) * 60;

    const alpha = cfg.health_smoothing_alpha ?? 0.12;
    const prevSm = health._smoothed || { slope_deg: 0, walk_speed_ms: 0 };
    const isMoving = (segment.surface_distance_m || 0) > 0.01;
    const smoothedSegment = isMoving
        ? {
            ...segment,
            slope_deg: ema(prevSm.slope_deg, segment.slope_deg || 0, alpha),
            walk_speed_ms: ema(prevSm.walk_speed_ms, segment.walk_speed_ms || 0, alpha)
        }
        : { ...segment, slope_deg: 0, walk_speed_ms: 0 };

    const members = health.members.map((m, idx) => {
        const isLeader = isGroup && idx === health.leaderIndex;
        const effectiveTerrain = isGroup
            ? (isLeader ? cfg.leader_terrain_factor : cfg.follower_terrain_factor)
            : cfg.terrain_factor;
        const extraHr = isGroup ? (isLeader ? cfg.leader_extra_hr_bpm : 0) + cfg.group_cognitive_hr_bump_bpm : 0;

        const prev = { ...m };
        const newState = advanceMemberState(smoothedSegment, prev, m, { ...cfg, terrain_factor: effectiveTerrain });
        newState.heart_rate_bpm = Math.min(cfg.hr_max_bpm, newState.heart_rate_bpm + extraHr);
        newState.hr_fraction_of_max = newState.heart_rate_bpm / cfg.hr_max_bpm;
        newState.flags.hr_above_85pct_max = newState.heart_rate_bpm > 0.85 * cfg.hr_max_bpm;
        newState.role = isGroup ? (isLeader ? 'leader' : 'follower') : 'solo';
        return { ...m, ...newState };
    });

    let leaderIndex = health.leaderIndex;
    let rotationClockMin = health.rotationClockMin + t_min;
    let totalRotations = health.totalRotations;
    if (isGroup && cfg.leader_rotation_interval_min > 0 && members.length > 1) {
        while (rotationClockMin >= cfg.leader_rotation_interval_min) {
            leaderIndex = (leaderIndex + 1) % members.length;
            rotationClockMin -= cfg.leader_rotation_interval_min;
            totalRotations += 1;
        }
    }

    return {
        ...health, members, leaderIndex, rotationClockMin, totalRotations,
        _smoothed: { slope_deg: smoothedSegment.slope_deg, walk_speed_ms: smoothedSegment.walk_speed_ms }
    };
}

export function aggregateGroupState(health) {
    const members = health.members;
    if (!members.length) return null;

    const argmax = (key) => members.reduce((a, b) => a[key] > b[key] ? a : b);
    const argmin = (key) => members.reduce((a, b) => a[key] < b[key] ? a : b);

    const bindingMet = argmax('metabolic_fraction_of_max');
    const bindingHR = argmax('hr_fraction_of_max');
    const bindingO2 = argmin('o2_remaining_l');
    const bindingThermal = argmax('t_core_c');
    const bindingHydration = argmax('dehydration_pct_body_mass');

    const any = (key) => members.some((m) => m.flags?.[key]);

    let status = 'nominal';
    if (any('o2_depleted') || any('thermal_critical') || any('dehydration_critical')) status = 'critical';
    else if (any('over_sustainable_metabolic')) status = 'at_risk_over_sustainable';
    else if (any('thermal_warning') || any('dehydration_warning') || any('hr_above_85pct_max')) status = 'elevated';
    else if (any('o2_low')) status = 'low_o2';

    return {
        mode: health.mode, leaderIndex: health.leaderIndex,
        leaderId: members[health.leaderIndex]?.id, totalRotations: health.totalRotations,
        members: members.map((m) => ({
            id: m.id, role: m.role,
            o2_remaining_l: m.o2_remaining_l, o2_consumed_l_total: m.o2_consumed_l_total,
            metabolic_rate_w: m.metabolic_rate_w, heart_rate_bpm: m.heart_rate_bpm,
            t_core_c: m.t_core_c, dehydration_pct_body_mass: m.dehydration_pct_body_mass,
            energy_kj_total: m.energy_kj_total, total_distance_m: m.total_distance_m,
            total_time_h: m.total_time_h, flags: m.flags,
        })),
        binding_member_metabolic: bindingMet.id,
        binding_member_hr: bindingHR.id,
        binding_member_o2: bindingO2.id,
        binding_member_thermal: bindingThermal.id,
        binding_member_hydration: bindingHydration.id,
        mean_metabolic_w: members.reduce((s, m) => s + m.metabolic_rate_w, 0) / members.length,
        max_metabolic_w: Math.max(...members.map((m) => m.metabolic_rate_w)),
        mean_hr_bpm: members.reduce((s, m) => s + m.heart_rate_bpm, 0) / members.length,
        max_hr_bpm: Math.max(...members.map((m) => m.heart_rate_bpm)),
        min_o2_remaining_l: Math.min(...members.map((m) => m.o2_remaining_l)),
        max_t_core_c: Math.max(...members.map((m) => m.t_core_c)),
        max_dehydration_pct: Math.max(...members.map((m) => m.dehydration_pct_body_mass)),
        sum_o2_consumed_l: members.reduce((s, m) => s + m.o2_consumed_l_total, 0),
        sum_energy_kj: members.reduce((s, m) => s + m.energy_kj_total, 0),
        flags: {
            any_over_sustainable_metabolic: any('over_sustainable_metabolic'),
            any_hr_above_85pct_max: any('hr_above_85pct_max'),
            any_o2_low: any('o2_low'), any_o2_depleted: any('o2_depleted'),
            any_thermal_warning: any('thermal_warning'), any_thermal_critical: any('thermal_critical'),
            any_dehydration_warning: any('dehydration_warning'), any_dehydration_critical: any('dehydration_critical'),
        },
        status,
    };
}

export function loadHealthModePreference() {
    return localStorage.getItem(STORAGE_KEY_MODE) || 'solo';
}
export function saveHealthModePreference(mode) {
    if (mode === 'solo' || mode === 'group') localStorage.setItem(STORAGE_KEY_MODE, mode);
}