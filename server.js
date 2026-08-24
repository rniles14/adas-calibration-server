const express = require('express');
const exphbs = require('express-handlebars');
const path = require('path');
const app = express();
// Middleware
app.use(express.json());
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
    json: (context) => JSON.stringify(context, null, 2)
  }
});
app.engine('hbs', hbs.engine);
app.set('views', path.join(__dirname, 'Views'));
app.set('view engine', 'hbs');
// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running' });
});

// Counts calibrations by their calibration_category field.
// calibration_category must be one of exactly these 4 values (enforced by the Money Prompt):
//   "Static Calibration"
//   "Dynamic Calibration"
//   "Reset / Relearn / Initialization"
//   "Aim / Mechanical Adjustment"
// This is a strict exact match, not a substring/contains check, so there's no
// ambiguity or double-counting risk.
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
      // Catches anything missing or outside the 4 allowed values so it's visible
      // in logs rather than silently vanishing from the summary cards.
      counts.uncategorized++;
    }
  });

  return counts;
}

// Main endpoint: Generate calibration report
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
    // Validate required data
    if (!vehicle || !Array.isArray(calibrations_required)) {
      return res.status(400).json({
        error: 'Missing required fields: vehicle and calibrations_required array'
      });
    }

    const categoryCounts = countCalibrationCategories(calibrations_required);

    if (categoryCounts.uncategorized > 0) {
      console.warn(
        `Warning: ${categoryCounts.uncategorized} calibration(s) had a missing or ` +
        `invalid calibration_category (expected "Static Calibration", "Dynamic Calibration", ` +
        `"Reset / Relearn / Initialization", or "Aim / Mechanical Adjustment"). ` +
        `These will not appear in the summary cards.`
      );
    }

    // Prepare data for template
    const reportData = {
      vehicle,
      repair_items_count: repair_items_count || 0,
      calibrations_required: calibrations_required || [],
      calibrations_not_triggered: calibrations_not_triggered || [],
      recommended_sequence: recommended_sequence || [],
      adas_systems_present: adas_systems_present || [],
      safety_systems_present: safety_systems_present || [],
      brake_systems: brake_systems || [],

      // Calculated values - exact match against calibration_category
      static_calibrations_count: categoryCounts['Static Calibration'],
      dynamic_calibrations_count: categoryCounts['Dynamic Calibration'],
      relearn_reset_calibrations_count: categoryCounts['Reset / Relearn / Initialization'],
      aim_mechanical_calibrations_count: categoryCounts['Aim / Mechanical Adjustment'],

      // Report metadata
      generated_date: new Date().toLocaleDateString(),
      generated_time: new Date().toLocaleTimeString(),
      report_version: '1.0'
    };
    // Render template
    res.render('report', reportData);

  } catch (error) {
    console.error('Error generating report:', error);
    res.status(500).json({
      error: 'Failed to generate report',
      details: error.message
    });
  }
});
// Error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message
  });
});
// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ADAS Calibration Report Server running on port ${PORT}`);
  console.log(`POST to http://localhost:${PORT}/generate-report with JSON body`);
});
