const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Configure Handlebars
const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: false,
  helpers: {
    eq: (a, b) => a === b,
    gt: (a, b) => a > b,
    lt: (a, b) => a < b,
    inc: (value) => parseInt(value) + 1,
    toLowerCase: (str) => str ? str.toLowerCase() : '',
    toUpperCase: (str) => str ? str.toUpperCase() : '',
    formatList: (array) => {
      if (!array || !Array.isArray(array)) return '';
      return array.join(', ');
    },
    json: (context) => JSON.stringify(context, null, 2),
    currency: (value) => {
      if (value == null) return '—';
      return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
  }
});
app.engine('hbs', hbs.engine);
app.set('views', path.join(__dirname, 'Views'));
app.set('view engine', 'hbs');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// ─────────────────────────────────────────────
// PRICE TABLE — keyed by ServiceID
// Columns: Partner, StateFarm (covers Allstate too), Geico, AllOthers
// ─────────────────────────────────────────────
const PRICE_TABLE = {
  S001: { name: 'Front Radar',                          partner: 350,  statefarm: 400,  geico: 440,  allothers: 475  },
  S002: { name: 'Front Camera – Static w/ Targets',     partner: 350,  statefarm: 400,  geico: 440,  allothers: 475  },
  S003: { name: 'Front Camera – Dynamic',               partner: 180,  statefarm: 225,  geico: 270,  allothers: 375  },
  S004: { name: 'Surround View – Static w/ Targets',    partner: 550,  statefarm: 600,  geico: 600,  allothers: 750  },
  S005: { name: 'Surround View Dynamic',                partner: 260,  statefarm: 299,  geico: 270,  allothers: 375  },
  S006: { name: 'Blind Spot – Static',                  partner: 350,  statefarm: 400,  geico: 440,  allothers: 475  },
  S007: { name: 'Blind Spot – Dynamic',                 partner: 195,  statefarm: 225,  geico: 270,  allothers: 375  },
  S008: { name: 'LiDAR',                                partner: 900,  statefarm: 1500, geico: 1500, allothers: 2000 },
  S009: { name: 'Night Vision Systems',                 partner: 900,  statefarm: 1500, geico: 1500, allothers: 2000 },
  S010: { name: 'Park Sensors',                         partner: 85,   statefarm: 100,  geico: 125,  allothers: 125  },
  S011: { name: 'Rear Camera',                          partner: 275,  statefarm: 300,  geico: 300,  allothers: 425  },
  S012: { name: 'Steering Angle Reset',                 partner: 85,   statefarm: 100,  geico: 105,  allothers: 125  },
  S013: { name: 'Seat Weight Sensor',                   partner: 85,   statefarm: 100,  geico: 125,  allothers: 175  },
  S014: { name: 'Programming – All Others',             partner: 200,  statefarm: 250,  geico: 225,  allothers: 250  },
  S015: { name: 'Programming – Mercedes, Subaru',       partner: 350,  statefarm: 400,  geico: 400,  allothers: 400  },
  S016: { name: 'Programming – Audi, Porsche, VW',      partner: 450,  statefarm: 500,  geico: 500,  allothers: 500  },
  S017: { name: 'Diagnostic',                           partner: 150,  statefarm: 150,  geico: 165,  allothers: 165  },
  S018: { name: 'Pre Scan',                             partner: 90,   statefarm: 100,  geico: 130,  allothers: 139  },
  S019: { name: 'Post Scan',                            partner: 90,   statefarm: 100,  geico: 130,  allothers: 139  },
  S020: { name: 'Pre + Post Scan',                      partner: 175,  statefarm: 200,  geico: 260,  allothers: 278  },
  S021: { name: 'Labor',                                partner: 175,  statefarm: 175,  geico: 175,  allothers: 175  },
  S022: { name: 'EV-HV Off',                            partner: 150,  statefarm: 195,  geico: 195,  allothers: 195  },
  S023: { name: 'Front Wheel Alignment',                partner: 100,  statefarm: 100,  geico: 100,  allothers: 100  },
  S024: { name: 'All-Wheel Alignment',                  partner: 150,  statefarm: 150,  geico: 150,  allothers: 150  },
};

// ─────────────────────────────────────────────
// CARRIER DETECTION
// Maps insurance company string → price column key
// ─────────────────────────────────────────────
function detectCarrier(carrierString) {
  if (!carrierString) return 'allothers';
  const c = carrierString.toLowerCase();
  if (c.includes('state farm') || c.includes('allstate')) return 'statefarm';
  if (c.includes('geico')) return 'geico';
  return 'allothers';
}

// ─────────────────────────────────────────────
// CALIBRATION CATEGORY COUNTER (shared)
// ─────────────────────────────────────────────
function countCalibrationCategories(calibrations) {
  const counts = {
    'Static Calibration': 0,
    'Dynamic Calibration': 0,
    'Reset / Relearn / Initialization': 0,
    'Aim / Mechanical Adjustment': 0,
    uncategorized: 0
  };
  (calibrations || []).forEach(cal => {
    const category = cal.calibration_category;
    if (Object.prototype.hasOwnProperty.call(counts, category)) {
      counts[category]++;
    } else {
      counts.uncategorized++;
    }
  });
  return counts;
}

// ─────────────────────────────────────────────
// POST /generate-report  — existing insurance report (unchanged)
// ─────────────────────────────────────────────
app.post('/generate-report', (req, res) => {
  try {
    const {
      vehicle,
      repair_items_count,
      calibrations_required,
      calibrations_not_triggered,
      recommended_sequence,
      adas_systems_present,
      safety_systems_present,
      brake_systems
    } = req.body;

    if (!vehicle || !Array.isArray(calibrations_required)) {
      return res.status(400).json({
        error: 'Missing required fields: vehicle and calibrations_required array'
      });
    }

    const categoryCounts = countCalibrationCategories(calibrations_required);

    if (categoryCounts.uncategorized > 0) {
      console.warn(`Warning: ${categoryCounts.uncategorized} calibration(s) had an invalid calibration_category.`);
    }

    const reportData = {
      vehicle,
      repair_items_count: repair_items_count || 0,
      calibrations_required: calibrations_required || [],
      calibrations_not_triggered: calibrations_not_triggered || [],
      recommended_sequence: recommended_sequence || [],
      adas_systems_present: adas_systems_present || [],
      safety_systems_present: safety_systems_present || [],
      brake_systems: brake_systems || [],
      static_calibrations_count: categoryCounts['Static Calibration'],
      dynamic_calibrations_count: categoryCounts['Dynamic Calibration'],
      relearn_reset_calibrations_count: categoryCounts['Reset / Relearn / Initialization'],
      aim_mechanical_calibrations_count: categoryCounts['Aim / Mechanical Adjustment'],
      generated_date: new Date().toLocaleDateString(),
      generated_time: new Date().toLocaleTimeString(),
      report_version: '1.0'
    };

    res.render('report', reportData);

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

// ─────────────────────────────────────────────
// POST /generate-pitch-report  — pitch report for body shop partners
// Body shape:
//   calibrationData: string (raw JSON from Money Module)
//   carrier: string (insurance company name, may be blank)
//   claim: object with claim_information fields
//   vehicle_info: object with vehicle_information fields
// ─────────────────────────────────────────────
app.post('/generate-pitch-report', (req, res) => {
  try {
    // Parse the Money Module JSON string
    let calibrationData;
    try {
      let raw = typeof req.body.calibrationData === 'string'
        ? req.body.calibrationData
        : JSON.stringify(req.body.calibrationData);
      // Strip markdown fences if present
      raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
      calibrationData = JSON.parse(raw);
    } catch (e) {
      return res.status(400).json({ error: 'calibrationData is not valid JSON', details: e.message });
    }

    const carrierRaw = req.body.carrier || '';
    const carrierKey = detectCarrier(carrierRaw);
    const claim = req.body.claim || {};
    const vehicleInfo = req.body.vehicle_info || {};

    const { vehicle, calibrations_required, calibrations_not_triggered } = calibrationData;

    if (!vehicle || !Array.isArray(calibrations_required)) {
      return res.status(400).json({ error: 'calibrationData missing vehicle or calibrations_required' });
    }

    // Enrich each calibration with price and service name
    const enrichedCalibrations = calibrations_required.map(cal => {
      const row = PRICE_TABLE[cal.service_id] || null;
      return {
        ...cal,
        service_name: row ? row.name : cal.system,
        price: row ? row[carrierKey] : null,
      };
    });

    // Consolidate billing: same service_id = one billable procedure.
    // The calibration table still shows every triggered component,
    // but only the first entry per service_id carries the price.
    // The rest show "Included" so the shop sees coverage without double-billing.
    const seenServiceIds = new Set();
    enrichedCalibrations.forEach(cal => {
      if (seenServiceIds.has(cal.service_id)) {
        cal.consolidated = true;
        cal.original_price = cal.price;
        cal.price = null;
      } else {
        seenServiceIds.add(cal.service_id);
        cal.consolidated = false;
      }
    });

    // Recalculate total after consolidation
    const calibrationTotal = enrichedCalibrations.reduce((sum, c) => sum + (c.price || 0), 0);


    // Standing line items — pre first, post last
    const preItems = [
      { service_name: 'Pre-Repair Diagnostic Scan', price: PRICE_TABLE['S018'][carrierKey] },
    ];
    const postItems = [
      { service_name: 'Post-Repair Diagnostic Scan', price: PRICE_TABLE['S019'][carrierKey] },
    ];


    const preTotal = preItems.reduce((sum, s) => sum + (s.price || 0), 0);
    const postTotal = postItems.reduce((sum, s) => sum + (s.price || 0), 0);
    const grandTotal = calibrationTotal + preTotal + postTotal;

    // Carrier display label
    const carrierLabels = {
      statefarm: 'State Farm / Allstate',
      geico: 'Geico',
      allothers: 'Standard Rate'
    };

    const categoryCounts = countCalibrationCategories(calibrations_required);

    const reportData = {
      // Vehicle
      vehicle,
      vehicle_description: vehicleInfo.full_vehicle_description || `${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      mileage: vehicleInfo.mileage || null,
      exterior_color: vehicleInfo.exterior_color || null,

      // Claim
      claim_number: claim.claim_number || null,
      insurance_company: claim.insurance_company || carrierRaw || null,
      estimator_name: claim.estimator_name || null,
      repair_facility: claim.repair_facility || null,
      estimate_date: claim.estimate_date || null,
      impact_area: claim.impact_area || null,
      estimating_system: claim.estimating_system || null,

      // Pricing
      carrier_label: carrierLabels[carrierKey],
      enriched_calibrations: enrichedCalibrations,
      pre_items: preItems,
      post_items: postItems,
      pre_scan_price: preItems[0] ? preItems[0].price : 0,
      post_scan_price: postItems[0] ? postItems[0].price : 0,
      calibration_total: calibrationTotal,
      grand_total: grandTotal,

      // Summary counts
      total_calibrations: calibrations_required.length,
      total_line_items: calibrations_required.length + 2,
      static_calibrations_count: categoryCounts['Static Calibration'],
      dynamic_calibrations_count: categoryCounts['Dynamic Calibration'],
      relearn_reset_calibrations_count: categoryCounts['Reset / Relearn / Initialization'],
      aim_mechanical_calibrations_count: categoryCounts['Aim / Mechanical Adjustment'],

      // Not triggered
      calibrations_not_triggered: calibrations_not_triggered || [],

      // Meta
      generated_date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      report_id: 'CMA-' + Date.now().toString().slice(-6),
    };

    res.render('pitch-report', reportData);

  } catch (error) {
    console.error('Error generating pitch report:', error);
    res.status(500).json({ error: 'Failed to generate pitch report', details: error.message });
  }
});

// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error', details: err.message });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ADAS Calibration Report Server running on port ${PORT}`);
  console.log(`POST to http://localhost:${PORT}/generate-report with JSON body`);
  console.log(`POST to http://localhost:${PORT}/generate-pitch-report for pitch reports`);
});
