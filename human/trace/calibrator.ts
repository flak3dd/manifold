// ── Behavioral calibrator — trains models from human traces ─────────

// Uses imported trace data to fit statistical models for realistic behavior.
// Implements online GMM fitting and curvature analysis with entropy weighting.

import type { MouseTraceSegment, VelocityGMM, CurvatureHistogram } from ./importer.js;

export interface CalibrationResult {
  velocityGMM: VelocityGMM;
  curvatureHistogram: CurvatureHistogram;
  mixtureKurtosis: number;
  weightedCurvatureEntropy: number;
}

/** Online Expectation-Maximization for Gaussian Mixture Model */
export class OnlineGMMFitter {
  private nComponents: number;
  private dimensions: number;
  private weights: number[];
  private means: number[][];
  private covariances: number[][][];
  private nSamples: number;

  constructor(nComponents: number, dimensions: number) {
    this.nComponents = nComponents;
    this.dimensions = dimensions;
    this.weights = new Array(nComponents).fill(1/nComponents);
    this.means = Array.from({length: nComponents}, () => 
      new Array(dimensions).fill(0)
    );
    this.covariances = Array.from({length: nComponents}, () =>
      Array.from({length: dimensions}, () =>
        new Array(dimensions).fill(0)
      )
    );
    this.nSamples = 0;
  }

  /** Update model with new velocity sample */
  fitSample(velocity: number): void {
    this.nSamples++;
    const responsibilities = this.computeResponsibilities([velocity]);
    
    // Update weights, means, covariances
    for (let k = 0; k < this.nComponents; k++) {
      const gamma = responsibilities[k][0]; // Since single dimension
      
      // Update weights
      this.weights[k] = (this.weights[k] * (this.nSamples - 1) + gamma) / this.nSamples;
      
      // Update means
      for (let d = 0; d < this.dimensions; d++) {
        this.means[k][d] = (this.means[k][d] * (this.nSamples - 1) + gamma * velocity) / this.nSamples;
      }
      
      // Update covariances (simplified for 1D)
      const diff = velocity - this.means[k][0];
      this.covariances[k][0][0] = (this.covariances[k][0][0] * (this.nSamples - 1) + gamma * diff * diff) / this.nSamples;
    }
  }

  private computeResponsibilities(sample: number[]): number[][] {
    const responsibilities = [];
    let totalProb = 0;
    
    for (let k = 0; k < this.nComponents; k++) {
      const prob = this.weights[k] * this.gaussianPdf(sample, k);
      responsibilities.push([prob]);
      totalProb += prob;
    }
    
    // Normalize
    for (let k = 0; k < this.nComponents; k++) {
      responsibilities[k][0] /= totalProb;
    }
    
    return responsibilities;
  }
  
  private gaussianPdf(x: number[], component: number): number {
    // Simplified 1D Gaussian PDF
    const mean = this.means[component][0];
    const variance = Math.max(this.covariances[component][0][0], 0.01); // Avoid division by zero
    const diff = x[0] - mean;
    const exponent = -0.5 * diff * diff / variance;
    
    return Math.exp(exponent) / Math.sqrt(2 * Math.PI * variance);
  }
  
  getModel(): VelocityGMM {
    return {
      components: {
        weights: this.weights.slice(),
        means: this.means.map(m => m.slice()),
        covariances: this.covariances.map(c => c.map(row => row.slice())),
      },
      logLikelihood: -1000, // Placeholder
    };
  }
}

/** Calibrate behavioral models from trace data */
export function calibrateFromTraces(traces: MouseTraceSegment[]): CalibrationResult {
  const fitter = new OnlineGMMFitter(3, 1); // 3 components, 1D (velocity)
  
  // Fit GMM to all velocity data
  for (const trace of traces) {
    for (const velocity of trace.velocity) {
      if (velocity > 0 && velocity < 5000) { // Reasonable bounds
        fitter.fitSample(velocity);
      }
    }
  }
  
  const velocityGMM = fitter.getModel();
  
  // Build curvature histogram with velocity weighting
  const curvatureHistogram = buildWeightedCurvatureHistogram(traces);
  
  // Calculate mixture kurtosis and weighted entropy
  const mixtureKurtosis = calculateMixtureKurtosis(velocityGMM);
  const weightedCurvatureEntropy = curvatureHistogram.entropy;
  
  return {
    velocityGMM,
    curvatureHistogram,
    mixtureKurtosis,
    weightedCurvatureEntropy,
  };
}

/** Build curvature histogram weighted by inverse velocity */
function buildWeightedCurvatureHistogram(traces: MouseTraceSegment[]): CurvatureHistogram {
  const curvatures: number[] = [];
  const weights: number[] = [];
  
  for (const trace of traces) {
    for (let i = 0; i < trace.curvature.length; i++) {
      const curvature = trace.curvature[i];
      const velocity = trace.velocity[i] || 1;
      
      if (curvature > 0 && curvature < 10) { // Reasonable bounds
        curvatures.push(curvature);
        weights.push(1 / Math.sqrt(velocity)); // Weight by inverse velocity
      }
    }
  }
  
  // Create histogram with 20 bins
  const binCount = 20;
  const minCurv = Math.min(...curvatures);
  const maxCurv = Math.max(...curvatures);
  const binWidth = (maxCurv - minCurv) / binCount;
  
  const bins = new Array(binCount).fill(0);
  const binEdges = [];
  
  for (let i = 0; i <= binCount; i++) {
    binEdges.push(minCurv + i * binWidth);
  }
  
  // Fill bins with weights
  for (let i = 0; i < curvatures.length; i++) {
    const binIdx = Math.floor((curvatures[i] - minCurv) / binWidth);
    const safeIdx = Math.max(0, Math.min(binCount - 1, binIdx));
    bins[safeIdx] += weights[i];
  }
  
  // Calculate weighted entropy
  let totalWeight = 0;
  let entropy = 0;
  
  for (const binWeight of bins) {
    totalWeight += binWeight;
  }
  
  for (const binWeight of bins) {
    if (binWeight > 0) {
      const p = binWeight / totalWeight;
      entropy -= p * Math.log2(p);
    }
  }
  
  return {
    bins,
    binEdges,
    entropy,
  };
}

/** Calculate kurtosis of the GMM mixture */
function calculateMixtureKurtosis(gmm: VelocityGMM): number {
  let kurtosis = 0;
  let totalWeight = 0;
  
  for (let k = 0; k < gmm.components.weights.length; k++) {
    const weight = gmm.components.weights[k];
    const mean = gmm.components.means[k][0];
    const variance = gmm.components.covariances[k][0][0];
    
    if (variance > 0) {
      const componentKurtosis = (weight / variance) * (weight / variance); // Simplified
      kurtosis += componentKurtosis;
      totalWeight += weight;
    }
  }
  
  return totalWeight > 0 ? kurtosis / totalWeight : 0;
}

/** Apply calibration result to entropy tracker */
export function applyCalibration(calibration: CalibrationResult): {
  velocitySampler: () => number;
  curvatureWeightFunction: (velocity: number) => number;
} {
  return {
    velocitySampler: () => {
      // Sample from fitted GMM (simplified)
      const component = Math.floor(Math.random() * calibration.velocityGMM.components.weights.length);
      const mean = calibration.velocityGMM.components.means[component][0];
      const stddev = Math.sqrt(calibration.velocityGMM.components.covariances[component][0][0]);
      return mean + stddev * (Math.random() - 0.5) * 2; // Simplified sampling
    },
    
    curvatureWeightFunction: (velocity: number) => {
      // Return weight for curvature based on velocity
      return 1 / Math.sqrt(Math.max(velocity, 1));
    }
  };
}

