/* Modelo fisiológico Fase G2: metabólico + cardiovascular + O2 + térmico + hidratación.
 * G2.1 gravedad · G2.2 presión · G2.3 térmico · G2.4 hidratación. */

export function slopeToGradePercent(slope_deg) {
    return Math.tan(slope_deg * Math.PI / 180) * 100;
}

export function calculateMetabolicRateW(inputs, cfg = null) {
    const W = inputs.body_mass_kg, L = inputs.suit_mass_kg, V = inputs.walk_speed_ms;
    const G = slopeToGradePercent(inputs.signed_slope_deg);
    const baseline = 1.5 * W + 2.0 * (W + L) * (L / W) ** 2;
    const effort = inputs.terrain_factor * (W + L) * (1.5 * V * V + 0.35 * V * G);
    let raw = baseline + effort;
    let m = Math.max(raw, 0.5 * baseline);

    let gravityFactor = 1.0, pressureOverheadW = 0.0;
    if (cfg) {
        if (cfg.gravity_correction_mode === 'linear_vertical') {
            gravityFactor = cfg.gravity_ms2 / cfg.gravity_earth_ms2;
            raw = baseline + effort * gravityFactor;
            m = Math.max(raw, 0.5 * baseline);
        } else if (cfg.gravity_correction_mode === 'empirical') {
            gravityFactor = cfg.gravity_empirical_factor;
            raw *= gravityFactor;
            m *= gravityFactor;
        }
        if (cfg.suit_pressure_overhead_mode === 'percent_overhead') {
            pressureOverheadW = m * cfg.suit_pressure_overhead_fraction;
            raw += pressureOverheadW;
            m += pressureOverheadW;
        }
    }

    return {
        baseline_w: baseline,
        effort_w: effort,
        metabolic_rate_raw_w: raw,
        metabolic_rate_w: m,
        grade_percent: G,
        gravity_factor_applied: gravityFactor,
        pressure_overhead_w: pressureOverheadW,
    };
}

export function metabolicToVO2Lmin(M_w, rer = 0.82) {
    const rerC = Math.max(0.7, Math.min(1.0, rer));
    const kJPerL = 19.6 + (rerC - 0.7) / 0.3 * 1.5;
    return M_w * 60 / (kJPerL * 1000);
}

export function estimateHeartRateBpm(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.hr_rest_bpm + (cfg.hr_walk_target_bpm - cfg.hr_rest_bpm) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.hr_walk_target_bpm + (cfg.hr_max_bpm - cfg.hr_walk_target_bpm) * t;
}

export function estimateStrokeVolumeMl(M_w, cfg) {
    const m_th = cfg.hr_m_threshold_w, m_max = cfg.hr_m_max_w;
    if (M_w <= m_th) {
        const t = Math.max(0, M_w / m_th);
        return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * t;
    }
    const t = Math.min(1, (M_w - m_th) / (m_max - m_th));
    return cfg.sv_rest_ml + (cfg.sv_max_ml - cfg.sv_rest_ml) * (0.5 + 0.5 * t);
}

/* G2.3 — Térmico (Gagge simplificado).
 * k_loss = 0.5 W/K refleja la resistencia térmica efectiva del MLI del traje
 * (antes 2.0 W/K, irreal: enfriaba incluso a M=600 W). Con 0.5 W/K, flat walking
 * produce +41 W de calor neto y LCVG failure eleva T_core como debe. */
export function advanceThermalState(prevT, M_w, ambient_temp_c, t_h, member, cfg) {
    if (cfg.thermal_mode === 'nominal') {
        const targetT = cfg.t_core_initial_c + Math.min(0.4, Math.max(0, (M_w - 300) / 1500) * 0.4);
        return Math.min(cfg.t_core_initial_c + 0.4, Math.max(cfg.t_core_initial_c, prevT + (targetT - prevT) * Math.min(1, t_h * 2)));
    }
    const m_kg = member.body_mass_kg;
    const c_p = cfg.body_c_p_kj_kg_k * 1000;
    const k_loss = 0.5;
    const heatInput = M_w * (1 - cfg.thermal_lcvg_efficiency);
    const heatLoss = k_loss * (prevT - ambient_temp_c);
    const netHeatW = heatInput - heatLoss;
    const dT = (netHeatW / (m_kg * c_p)) * t_h * 3600;
    return Math.min(45, prevT + dT);
}

export function advanceHydrationState(prevDeficit, M_w, t_core, t_h, cfg) {
    const sweatRate = 0.4 * (M_w / 600) * (1 + Math.max(0, (t_core - 37)) * 0.2);
    const sweat = sweatRate * t_h;
    const provision = cfg.potable_water_provision_l_h * t_h;
    return Math.max(0, prevDeficit + sweat - provision);
}

export function advanceMemberState(segment, prevState, member, cfg) {
    const t_h = Math.max(0, segment.walking_time_h || 0);
    const slope = Math.max(0, Math.min(90, segment.slope_deg || 0));
    const delta = segment.delta_elev_m || 0;
    const signedSlope = delta >= 0 ? slope : -slope;
    const effectiveSpeed = segment.walk_speed_ms ?? cfg.walk_speed_ms;

    const metab = calculateMetabolicRateW({
        body_mass_kg: member.body_mass_kg,
        suit_mass_kg: cfg.suit_mass_kg,
        walk_speed_ms: effectiveSpeed,
        signed_slope_deg: signedSlope,
        terrain_factor: cfg.terrain_factor,
    }, cfg);

    const vo2 = metabolicToVO2Lmin(metab.metabolic_rate_w, cfg.rer_assumed);
    const vco2 = vo2 * cfg.rer_assumed;
    const hr = estimateHeartRateBpm(metab.metabolic_rate_w, cfg);
    const sv = estimateStrokeVolumeMl(metab.metabolic_rate_w, cfg);
    const co = hr * sv / 1000;
    const energy_kj = metab.metabolic_rate_w * t_h * 3.6;
    const o2_consumed_l = vo2 * 60 * t_h;
    const o2_remaining_l = Math.max(0, (prevState.o2_remaining_l ?? member.o2_capacity_l_equiv) - o2_consumed_l);

    const ambient_temp_c = segment.ambient_temp_c ?? -63;
    const prevT = prevState.t_core_c ?? cfg.t_core_initial_c;
    const t_core_c = advanceThermalState(prevT, metab.metabolic_rate_w, ambient_temp_c, t_h, member, cfg);
    const prevDef = prevState.hydration_deficit_l ?? 0;
    const hydration_deficit_l = advanceHydrationState(prevDef, metab.metabolic_rate_w, t_core_c, t_h, cfg);
    const dehydrationPct = (hydration_deficit_l / member.body_mass_kg) * 100;

    return {
        member_id: member.id,
        o2_remaining_l,
        o2_consumed_l_total: (prevState.o2_consumed_l_total || 0) + o2_consumed_l,
        energy_kj_total: (prevState.energy_kj_total || 0) + energy_kj,
        metabolic_rate_w: metab.metabolic_rate_w,
        metabolic_fraction_of_max: metab.metabolic_rate_w / cfg.max_sustainable_m_w,
        gravity_factor_applied: metab.gravity_factor_applied,
        pressure_overhead_w: metab.pressure_overhead_w,
        vo2_l_min: vo2,
        vco2_l_min: vco2,
        heart_rate_bpm: hr,
        hr_fraction_of_max: hr / cfg.hr_max_bpm,
        stroke_volume_ml: sv,
        cardiac_output_l_min: co,
        total_time_h: (prevState.total_time_h || 0) + t_h,
        total_distance_m: (prevState.total_distance_m || 0) + (segment.surface_distance_m || 0),
        t_core_c,
        hydration_deficit_l,
        dehydration_pct_body_mass: dehydrationPct,
        dose_usv: null,
        time_to_incapacitation_min: null,
        flags: {
            over_sustainable_metabolic: metab.metabolic_rate_w > cfg.max_sustainable_m_w,
            hr_above_85pct_max: hr > 0.85 * cfg.hr_max_bpm,
            o2_low: o2_remaining_l < cfg.o2_critical_threshold_l,
            o2_depleted: o2_remaining_l <= 0,
            thermal_warning: t_core_c > cfg.t_core_warning_c,
            thermal_critical: t_core_c > cfg.t_core_critical_c,
            dehydration_warning: dehydrationPct > cfg.dehydration_warning_pct_body_mass,
            dehydration_critical: dehydrationPct > cfg.dehydration_critical_pct_body_mass,
        },
    };
}

export function initMemberState(member, cfg) {
    return {
        member_id: member.id,
        o2_remaining_l: member.o2_capacity_l_equiv,
        o2_consumed_l_total: 0,
        energy_kj_total: 0,
        metabolic_rate_w: 0,
        metabolic_fraction_of_max: 0,
        gravity_factor_applied: 1.0,
        pressure_overhead_w: 0,
        vo2_l_min: 0,
        vco2_l_min: 0,
        heart_rate_bpm: cfg.hr_rest_bpm,
        hr_fraction_of_max: cfg.hr_rest_bpm / cfg.hr_max_bpm,
        stroke_volume_ml: cfg.sv_rest_ml,
        cardiac_output_l_min: 0,
        total_time_h: 0,
        total_distance_m: 0,
        t_core_c: cfg.t_core_initial_c,
        hydration_deficit_l: 0,
        dehydration_pct_body_mass: 0,
        dose_usv: null,
        time_to_incapacitation_min: null,
        flags: {
            over_sustainable_metabolic: false,
            hr_above_85pct_max: false,
            o2_low: false,
            o2_depleted: false,
            thermal_warning: false,
            thermal_critical: false,
            dehydration_warning: false,
            dehydration_critical: false,
        },
    };
}