# support-cost-estimator
It tracks current and projected premium support needs and compares vendor options.

## Getting started

1. Open `index.html` in a browser to try the interactive UI. Paste or upload vendor pricing JSON, tweak the scenario inputs, and click **Compare Now** to visualize results.
2. Edit `vendors.example.json` to customize sample pricing catalogs that the UI loads by default.
3. Run the quick console harness with:

   ```bash
   node quick_tests.js
   ```

   The script logs compact comparison tables for baseline and growth scenarios so you can validate pricing logic without the browser UI.