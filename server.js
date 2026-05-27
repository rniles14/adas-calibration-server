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
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hbs');

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Server running' });
});

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
      
      // Calculated values
      static_calibrations_count: (calibrations_required || []).filter(c => c.calibration_type === 'Static').length,
      dynamic_calibrations_count: (calibrations_required || []).filter(c => c.calibration_type === 'Dynamic').length,
      aim_calibrations_count: (calibrations_required || []).filter(c => c.calibration_type && c.calibration_type.includes('Aim')).length,
      scan_calibrations_count: (calibrations_required || []).filter(c => c.calibration_type && c.calibration_type.includes('Scan')).length,
      
      // Report metadata
      generated_date: new Date().toLocaleDateString(),
      generated_time: new Date().toLocaleTimeString(),
      report_version: '1.0'
    };

    // Render template
    const html = hbs.engine(
      path.join(__dirname, 'views/report.hbs'),
      reportData,
      { layout: false }
    );

    res.type('text/html').send(html);
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
