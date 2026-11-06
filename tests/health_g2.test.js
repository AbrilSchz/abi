import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateMetabolicRateW, advanceMemberState, initMemberState } from '../src/health.js';
import { resolveHealthConfig, createGroupHealth, advanceGroupState } from '../src/health_group.js';
import { computeHealthCostFactor, computeHealthOptimalRoute } from '../src/health_route.js';
import { computeHealthAwareRoute, compareRoutes, PRESETS } from '../src/health_route_astar.js';
import { DEFAULT_HEALTH } from '../src/health_defaults.js';

const CFG = resolveHealthConfig();
const MEMBER = { id: 'test', body_mass_kg: 80, age_years: 40, o2_capacity_l_equiv: 580 };

test('G2.1 empirical gravity: 0.80 factor applied', () => {
    const cfg = { ...CFG, gravity_correction_mode: 'empirical', gravity_empirical_factor: 0.80 };
    const with_ = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 5, terrain_factor: 1.1 }, cfg);
    const without = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 5, terrain_factor: 1.1 }, { ...cfg, gravity_correction_mode: 'none' });
    assert.ok(Math.abs(with_.metabolic_rate_w - without.metabolic_rate_w * 0.80) < 1);
    assert.equal(with_.gravity_factor_applied, 0.80);
});

test('G2.1 linear_vertical: only effort scales with g ratio', () => {
    const cfg = { ...CFG, gravity_correction_mode: 'linear_vertical' };
    const mars = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 15, terrain_factor: 1.1 }, cfg);
    const earth = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 15, terrain_factor: 1.1 }, { ...cfg, gravity_correction_mode: 'none' });
    assert.ok(mars.metabolic_rate_w < earth.metabolic_rate_w);
    assert.ok(Math.abs(mars.gravity_factor_applied - 0.3782) < 0.01);
});

test('G2.1 none: backward compatible with G1', () => {
    /* AMBOS con pressure off, para aislar solo el efecto gravedad */
    const cfg_none = { ...CFG, gravity_correction_mode: 'none', suit_pressure_overhead_mode: 'none' };
    const a = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 10, terrain_factor: 1.1 }, cfg_none);
    const b = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 10, terrain_factor: 1.1 });
    assert.equal(a.metabolic_rate_w, b.metabolic_rate_w);
});

test('G2.2 pressure overhead adds 30%', () => {
    const cfg = { ...CFG, gravity_correction_mode: 'none', suit_pressure_overhead_mode: 'percent_overhead', suit_pressure_overhead_fraction: 0.30 };
    const with_ = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 5, terrain_factor: 1.1 }, cfg);
    const without = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 5, terrain_factor: 1.1 }, { ...cfg, suit_pressure_overhead_mode: 'none' });
    assert.ok(Math.abs(with_.metabolic_rate_w - without.metabolic_rate_w * 1.30) < 2);
    assert.ok(with_.pressure_overhead_w > 0);
});

test('G2.1 + G2.2 compose: 0.80 × 1.30 = 1.04', () => {
    const cfg = { ...CFG, gravity_correction_mode: 'empirical', gravity_empirical_factor: 0.80, suit_pressure_overhead_mode: 'percent_overhead', suit_pressure_overhead_fraction: 0.30 };
    const composed = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 10, terrain_factor: 1.1 }, cfg);
    const baseline = calculateMetabolicRateW({ body_mass_kg: 80, suit_mass_kg: 60, walk_speed_ms: 1.2, signed_slope_deg: 10, terrain_factor: 1.1 }, { ...cfg, gravity_correction_mode: 'none', suit_pressure_overhead_mode: 'none' });
    assert.ok(Math.abs(composed.metabolic_rate_w / baseline.metabolic_rate_w - 1.04) < 0.02);
});

test('G2.3 thermal nominal: T_core stays near initial', () => {
    const cfg = { ...CFG, thermal_mode: 'nominal' };
    let state = initMemberState(MEMBER, cfg);
    const seg = { walking_time_h: 1, slope_deg: 10, delta_elev_m: 100, surface_distance_m: 4000, walk_speed_ms: 1.2, ambient_temp_c: -63 };
    for (let i = 0; i < 5; i++) state = advanceMemberState(seg, state, MEMBER, cfg);
    assert.ok(state.t_core_c >= 37.0 && state.t_core_c <= 37.5, `T_core=${state.t_core_c}`);
    assert.equal(state.flags.thermal_warning, false);
});

test('G2.3 thermal failure: T_core rises above warning', () => {
    const cfg = { ...CFG, thermal_mode: 'failure' };
    let state = initMemberState(MEMBER, cfg);
    const seg = { walking_time_h: 1, slope_deg: 15, delta_elev_m: 200, surface_distance_m: 4000, walk_speed_ms: 1.2, ambient_temp_c: -63 };
    for (let i = 0; i < 5; i++) state = advanceMemberState(seg, state, MEMBER, cfg);
    assert.ok(state.t_core_c > 38.0, `T_core=${state.t_core_c}`);
    assert.equal(state.flags.thermal_warning, true);
});

test('G2.4 hydration: deficit accumulates', () => {
    const group = createGroupHealth();
    const seg = { walking_time_h: 0.5, slope_deg: 5, delta_elev_m: 20, surface_distance_m: 1000, walk_speed_ms: 1.2 };
    let s = group;
    for (let i = 0; i < 8; i++) s = advanceGroupState(s, seg);
    assert.ok(s.members[0].hydration_deficit_l > 0);
});

test('G2.5 cost factor oxygen mode = 1.0', () => {
    const g = createGroupHealth();
    const seg = { walking_time_h: 0.1, slope_deg: 10, delta_elev_m: 50, surface_distance_m: 200, walk_speed_ms: 1.2 };
    assert.equal(computeHealthCostFactor(seg, g, g.cfg.route_weights, 'oxygen'), 1.0);
});

test('G2.5 cost factor health mode penalizes steep slope', () => {
    const g = createGroupHealth();
    const flat = { walking_time_h: 0.1, slope_deg: 2, delta_elev_m: 5, surface_distance_m: 200, walk_speed_ms: 1.2 };
    const steep = { walking_time_h: 0.1, slope_deg: 20, delta_elev_m: 100, surface_distance_m: 200, walk_speed_ms: 1.2 };
    const fFlat = computeHealthCostFactor(flat, g, g.cfg.route_weights, 'health');
    const fSteep = computeHealthCostFactor(steep, g, g.cfg.route_weights, 'health');
    assert.ok(fSteep > fFlat);
});

test('G2.5 balanced mode is less aggressive than health', () => {
    const g = createGroupHealth();
    const seg = { walking_time_h: 0.1, slope_deg: 15, delta_elev_m: 75, surface_distance_m: 200, walk_speed_ms: 1.2 };
    const h = computeHealthCostFactor(seg, g, g.cfg.route_weights, 'health');
    const b = computeHealthCostFactor(seg, g, g.cfg.route_weights, 'balanced');
    assert.ok(b < h);
});

test('G2.5 route returns metrics + final group state', () => {
    const g = createGroupHealth();
    const mockDem = {
        resolution_m: 20,
        sample_elevation_m: (x, z) => 0.05 * x,
        sample_slope_deg: () => 4,
    };
    const path = [[0, 0], [1000, 0]];
    const result = computeHealthOptimalRoute(path, mockDem, g, 'health');
    assert.ok(result);
    assert.ok(result.metrics.total_distance_m > 900);
    assert.ok(result.metrics.max_slope_deg >= 0);
    assert.equal(result.source, 'health_route_v1');
});

test('G2.5 A* computeHealthAwareRoute runs without NaN and reaches goal', () => {
    const g = createGroupHealth();
    const sampleElevation = (x, z) => Math.sin(x * 0.01) * 10 + Math.cos(z * 0.01) * 5;
    const sampleSlope = (x, z) => Math.min(20, Math.abs(x * 0.01) * 2);

    const classic = computeHealthAwareRoute({
        sampleElevation, sampleSlope,
        resolution_m: 20, cols: 50, rows: 50,
        start_m: [-400, -400], goal_m: [400, 400],
        group: g, dimensions: PRESETS.classic,
        options: { step_m: 20 },
    });

    assert.equal(classic.failed, false);
    assert.ok(classic.path_m.length > 5);
    assert.ok(!isNaN(classic.metrics.total_cost));
    assert.ok(!isNaN(classic.metrics.total_distance_m));
    assert.ok(!isNaN(classic.components_avg.slope));

    const safety = computeHealthAwareRoute({
        sampleElevation, sampleSlope,
        resolution_m: 20, cols: 50, rows: 50,
        start_m: [-400, -400], goal_m: [400, 400],
        group: g, dimensions: PRESETS.safety,
        options: { step_m: 20 },
    });

    assert.equal(safety.failed, false);
    assert.ok(!isNaN(safety.metrics.total_cost));
    assert.ok(!isNaN(safety.metrics.total_distance_m));
    assert.ok(!isNaN(safety.components_avg.metabolic));
});

test('G2.5 compareRoutes produces valid deltas between classic and health routes', () => {
    const g = createGroupHealth();
    const sampleElevation = (x, z) => 0.05 * x;
    const sampleSlope = () => 5;

    const pathA = [[0, 0], [200, 0], [400, 0]];
    const pathB = [[0, 0], [200, 50], [400, 0]];

    const comp = compareRoutes(pathA, pathB, sampleElevation, sampleSlope, g);
    assert.ok(comp.classic);
    assert.ok(comp.health);
    assert.ok(comp.deltas);
    assert.ok(typeof comp.deltas.distance_m === 'number');
    assert.ok(typeof comp.deltas.o2_used_l === 'number');
    assert.ok(!isNaN(comp.deltas.distance_m));
});

test('DEFAULT_HEALTH contains max_safe_slope_deg and route_weights.slope', () => {
    assert.equal(DEFAULT_HEALTH.max_safe_slope_deg, 25);
    assert.ok(typeof DEFAULT_HEALTH.route_weights.slope === 'number');
    assert.ok(DEFAULT_HEALTH.route_weights.slope > 0);
});
