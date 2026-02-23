/**
 * Mini Biosphere Simulation Engine
 * Models coupled photosynthesis + cellular respiration dynamics
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────────────
const SIM = {
    TICK_SECONDS: 3600,          // each tick = 1 simulated hour
    MAX_GLUCOSE: 1000,           // mmol in the biosphere pool
    MAX_WATER: 1000,             // relative water units
    LIGHT_TO_PHOTO_K: 0.0008,   // photosynthesis sensitivity to light
    MIN_O2_SURVIVAL: 1,          // % O2 below which animals suffocate
    MIN_GLUCOSE_SURVIVAL: 2,     // mmol below which starvation occurs
    CO2_TOXICITY_THRESHOLD: 5,  // % CO2 above which becomes harmful
    TEMP_PHOTO_OPT: 25,          // °C optimal temp for photosynthesis
    TEMP_RESP_OPT: 37,           // °C optimal temp for respiration
    TEMP_RANGE: 15,              // °C half-width of optimal temp bell curve
    DECOMP_CO2_RATE: 0.002,     // decomposer CO2 release fraction/tick
    WATER_CYCLE_RATE: 0.003,    // transpiration → water recovery fraction
    NUTRIENT_PHOTO_K: 0.8,      // nutrient saturation constant (Michaelis-Menten)
};

// ─── Helper Math ─────────────────────────────────────────────────────────────
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rand(lo, hi) { return lo + Math.random() * (hi - lo); }

/** Bell-curve temperature factor (0–1) */
function tempFactor(temp, opt, range) {
    return Math.exp(-0.5 * Math.pow((temp - opt) / range, 2));
}

/** Michaelis-Menten saturation (0–1) */
function mmSat(conc, km) {
    return conc / (conc + km);
}

// ─── Biosphere Class ─────────────────────────────────────────────────────────
export class Biosphere {
    /**
     * @param {object} cfg - initial configuration
     * cfg keys:
     *   lightIntensity  (0-100 lux units)
     *   photoperiod     (0-24 h/day light)
     *   initialCO2      (% vol)
     *   initialO2       (% vol)
     *   initialWater    (0-100)
     *   plantBiomass    (0-100)
     *   consumerCount   (0-50)
     *   decomposerActivity (0-100)
     *   temperature     (°C)
     *   nutrientLevel   (0-100)
     */
    constructor(cfg, name = 'Biosphere') {
        this.name = name;
        this.cfg = { ...cfg };
        this.reset();
    }

    reset() {
        const c = this.cfg;
        this.tick = 0;                         // hours elapsed
        this.o2 = clamp(c.initialO2, 0, 30);  // %
        this.co2 = clamp(c.initialCO2, 0, 10);// %
        this.water = clamp(c.initialWater, 0, 100);   // units
        this.glucose = 50;                     // mmol starting pool
        this.plantBiomass = clamp(c.plantBiomass, 0, 100);
        this.consumerPop = clamp(c.consumerCount, 0, 50);
        this.alive = true;
        this.cause = null;
        this.atpBalance = 0;                   // running ATP surplus
        this.history = [];                     // {tick, o2, co2, glucose, pop, health}
        this.health = 100;
        this.recordHistory();
    }

    /** Photoperiod fraction: are lights on this hour? */
    get lightOnFraction() {
        const hourOfDay = this.tick % 24;
        // Light centered at midday: on during [12 - p/2, 12 + p/2]
        const p = clamp(this.cfg.photoperiod, 0, 24);
        const start = 12 - p / 2;
        const end = 12 + p / 2;
        return (hourOfDay >= start && hourOfDay < end) ? 1 : 0;
    }

    /**
     * Compute gross photosynthesis rate (mmol O2/glucose produced per tick)
     * Rate = Vmax × L × [CO2] × ΔT_photo × MM(water) × MM(nutrient)
     */
    computePhotosynthesis() {
        const c = this.cfg;
        const lightEff = this.lightOnFraction * c.lightIntensity / 100;
        const tFact = tempFactor(c.temperature, SIM.TEMP_PHOTO_OPT, SIM.TEMP_RANGE);
        const waterFact = mmSat(this.water, 20);
        const co2Fact = mmSat(this.co2, 0.5);
        const nutrientFact = mmSat(c.nutrientLevel, 30) * SIM.NUTRIENT_PHOTO_K + (1 - SIM.NUTRIENT_PHOTO_K);
        const biomass = this.plantBiomass / 100;

        // Vmax scales with plant biomass
        const Vmax = 15; // mmol/hr at full capacity
        const rate = Vmax * biomass * lightEff * co2Fact * tFact * waterFact * nutrientFact;
        return Math.max(0, rate);
    }

    /**
     * Compute cellular respiration rate (mmol O2 consumed per tick)
     * Includes: plant dark respiration + animal aerobic respiration
     */
    computeRespiration() {
        const c = this.cfg;
        const tFact = tempFactor(c.temperature, SIM.TEMP_RESP_OPT, SIM.TEMP_RANGE);
        const o2Fact = mmSat(this.o2, 2);          // O2 availability
        const glucoseFact = mmSat(this.glucose, 10); // substrate availability

        // Basal plant respiration (even in dark)
        const plantResp = 1.5 * (this.plantBiomass / 100) * tFact * o2Fact * glucoseFact;

        // Consumer respiration (scales with population)
        const animalResp = 0.3 * this.consumerPop * tFact * o2Fact * glucoseFact;

        return Math.max(0, plantResp + animalResp);
    }

    /** Decomposer action: breaks down dead organic matter, releases CO2 */
    computeDecomposition() {
        const c = this.cfg;
        const tFact = tempFactor(c.temperature, 28, 10);
        return SIM.DECOMP_CO2_RATE * c.decomposerActivity * tFact * (100 - this.o2) / 100;
    }

    /** Run one simulation tick (1 hour) */
    step() {
        if (!this.alive) return;
        this.tick++;

        // ── Photosynthesis ─────────────────────────────────────────────────
        const photo = this.computePhotosynthesis();
        // 6CO2 + 6H2O → C6H12O6 + 6O2
        const co2Consumed = photo * 0.8;    // proportional CO2 drawn down
        const waterConsumed = photo * 0.4;  // water consumed
        const glucoseProduced = photo;
        const o2Produced = photo;

        // ── Cellular Respiration ───────────────────────────────────────────
        const resp = this.computeRespiration();
        // C6H12O6 + 6O2 → 6CO2 + 6H2O + ATP
        const o2Consumed = resp;
        const co2Released = resp * 0.9;
        const waterReleased = resp * 0.3;
        const glucoseConsumed = resp * 0.8;
        const atpProduced = resp * 38;     // ~38 ATP per glucose unit

        // ── Decomposition ──────────────────────────────────────────────────
        const decomp = this.computeDecomposition();

        // ── Water cycle ────────────────────────────────────────────────────
        // Transpiration + condensation returns some water
        const waterRecovered = this.water * SIM.WATER_CYCLE_RATE;

        // ── Apply deltas ───────────────────────────────────────────────────
        this.o2 = clamp(this.o2 + o2Produced - o2Consumed, 0, 40);
        this.co2 = clamp(this.co2 + co2Released + decomp - co2Consumed, 0, 20);
        this.water = clamp(this.water + waterReleased + waterRecovered - waterConsumed, 0, 100);
        this.glucose = clamp(this.glucose + glucoseProduced - glucoseConsumed, 0, SIM.MAX_GLUCOSE);
        this.atpBalance += atpProduced - resp * 30; // net ATP surplus

        // ── Population dynamics ─────────────────────────────────────────────
        if (this.consumerPop > 0) {
            const energyPerAnimal = atpProduced / Math.max(1, this.consumerPop);
            if (energyPerAnimal > 18 && this.glucose > 20 && this.o2 > 5) {
                // Favorable: slight population growth
                this.consumerPop = Math.min(50, this.consumerPop + rand(0, 0.05));
            } else if (energyPerAnimal < 8 || this.o2 < SIM.MIN_O2_SURVIVAL * 2) {
                // Unfavorable: population decline
                this.consumerPop = Math.max(0, this.consumerPop - rand(0.02, 0.12));
            }
        }

        // ── Plant growth / die-back ─────────────────────────────────────────
        if (photo > resp * 0.5 && this.water > 10 && this.glucose > 15) {
            this.plantBiomass = Math.min(100, this.plantBiomass + 0.02);
        } else if (photo < resp * 0.3 || this.water < 5 || this.glucose < 5) {
            this.plantBiomass = Math.max(0, this.plantBiomass - 0.05);
        }

        // ── Health calculation ──────────────────────────────────────────────
        let healthPenalty = 0;

        // O2 deficit
        if (this.o2 < SIM.MIN_O2_SURVIVAL) healthPenalty += 30;
        else if (this.o2 < 5) healthPenalty += (5 - this.o2) * 3;

        // CO2 toxicity
        if (this.co2 > SIM.CO2_TOXICITY_THRESHOLD) {
            healthPenalty += (this.co2 - SIM.CO2_TOXICITY_THRESHOLD) * 5;
        }

        // Glucose starvation
        if (this.glucose < SIM.MIN_GLUCOSE_SURVIVAL) healthPenalty += 20;
        else if (this.glucose < 10) healthPenalty += (10 - this.glucose) * 1.5;

        // Water stress
        if (this.water < 5) healthPenalty += 15;

        // Plant die-off
        if (this.plantBiomass < 2) healthPenalty += 20;

        // Temperature extremes
        if (this.cfg.temperature < 5 || this.cfg.temperature > 42) healthPenalty += 15;

        this.health = clamp(this.health - healthPenalty * 0.01 + 0.05, 0, 100);

        // ── Survival check ─────────────────────────────────────────────────
        if (this.health <= 0) {
            this.alive = false;
            this.cause = this._determineCause();
        }

        this.recordHistory();
    }

    _determineCause() {
        if (this.o2 < SIM.MIN_O2_SURVIVAL) return 'Oxygen depletion (asphyxiation)';
        if (this.co2 > SIM.CO2_TOXICITY_THRESHOLD + 3) return 'CO₂ toxicity (hypercapnia)';
        if (this.glucose < SIM.MIN_GLUCOSE_SURVIVAL && this.plantBiomass < 2) return 'Energy starvation (no photosynthesis)';
        if (this.water < 2) return 'Dehydration';
        if (this.cfg.temperature > 42) return 'Heat stress (enzyme denaturation)';
        if (this.cfg.temperature < 5) return 'Cold stress (metabolic shutdown)';
        return 'Ecosystem collapse (multiple factors)';
    }

    recordHistory() {
        this.history.push({
            tick: this.tick,
            o2: +this.o2.toFixed(2),
            co2: +this.co2.toFixed(2),
            glucose: +this.glucose.toFixed(1),
            pop: +this.consumerPop.toFixed(2),
            plantBiomass: +this.plantBiomass.toFixed(2),
            health: +this.health.toFixed(1),
            photoRate: +this.computePhotosynthesis().toFixed(3),
            respRate: +this.computeRespiration().toFixed(3),
        });
    }

    /** Snapshot of current state for display */
    get state() {
        return {
            tick: this.tick,
            o2: this.o2,
            co2: this.co2,
            water: this.water,
            glucose: this.glucose,
            consumerPop: this.consumerPop,
            plantBiomass: this.plantBiomass,
            atpBalance: this.atpBalance,
            health: this.health,
            alive: this.alive,
            cause: this.cause,
            photoRate: this.computePhotosynthesis(),
            respRate: this.computeRespiration(),
        };
    }
}
