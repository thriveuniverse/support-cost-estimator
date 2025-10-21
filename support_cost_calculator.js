/**
 * Support Cost Estimator Calculator
 * Provides vendor comparison and cost projection functionality
 */
(function() {
  'use strict';

  const SupportEstimator = {
    /**
     * Compare multiple vendors against a scenario
     * @param {Array} vendors - Array of vendor configuration objects
     * @param {Object} scenario - Scenario configuration with metrics and requirements
     * @returns {Object} Comparison results with validation
     */
    compareVendors: function(vendors, scenario) {
      const results = [];
      const errors = [];
      
      // Validate inputs
      if (!vendors || vendors.length === 0) {
        errors.push('No vendors provided for comparison');
      }
      if (!scenario) {
        errors.push('No scenario provided');
      } else {
        if (!scenario.monthly_tickets_total || scenario.monthly_tickets_total <= 0) {
          errors.push('Monthly tickets total must be greater than 0');
        }
        if (!scenario.current_cloud_spend || scenario.current_cloud_spend < 0) {
          errors.push('Cloud spend must be 0 or greater');
        }
      }

      // If validation fails, return early
      if (errors.length > 0) {
        return {
          scenario_name: scenario?.scenario_name || 'Unknown',
          results: [],
          validation: {
            valid: false,
            errors: errors
          }
        };
      }

      // Calculate costs for each vendor
      vendors.forEach(vendor => {
        try {
          const result = this.calculateVendorCost(vendor, scenario);
          results.push(result);
        } catch (err) {
          errors.push(`Error calculating ${vendor.name}: ${err.message}`);
        }
      });

      // Sort by monthly cost (ascending)
      results.sort((a, b) => a.monthly_cost - b.monthly_cost);

      return {
        scenario_name: scenario.scenario_name,
        results: results,
        validation: {
          valid: errors.length === 0,
          errors: errors
        }
      };
    },

    /**
     * Calculate cost for a single vendor
     */
    calculateVendorCost: function(vendor, scenario) {
      const projectedTickets = this.projectTickets(
        scenario.monthly_tickets_total,
        scenario.growth_rate_percent || 0,
        scenario.months_to_project || 1
      );
      
      const projectedSpend = this.projectSpend(
        scenario.current_cloud_spend,
        scenario.spend_growth_rate_percent || 0,
        scenario.months_to_project || 1
      );

      let monthlyCost = 0;
      const coverageMultiplier = this.getCoverageMultiplier(
        scenario.hours_of_coverage,
        vendor.sla_caps?.coverage
      );

      // Calculate based on pricing model
      switch (vendor.pricing_model) {
        case 'percent_spend':
          monthlyCost = (projectedSpend * vendor.rules.percent / 100);
          if (vendor.rules.min_fee) {
            monthlyCost = Math.max(monthlyCost, vendor.rules.min_fee);
          }
          break;

        case 'tiered':
          monthlyCost = this.calculateTieredCost(projectedTickets, vendor.rules.thresholds);
          break;

        case 'per_incident':
          monthlyCost = this.calculatePerIncidentCost(
            scenario.tickets_by_severity, 
            vendor.rules.price_per_incident,
            scenario.growth_rate_percent || 0,
            scenario.months_to_project || 1
          );
          break;

        case 'retainer_addons':
          monthlyCost = this.calculateRetainerCost(vendor.rules, scenario);
          break;

        default:
          throw new Error(`Unknown pricing model: ${vendor.pricing_model}`);
      }

      // Apply coverage multiplier
      monthlyCost *= coverageMultiplier;

      // Convert currency if needed
      const convertedCost = this.convertCurrency(
        monthlyCost,
        vendor.currency,
        scenario.currency,
        scenario.exchange_rates
      );

      // Check SLA compliance
      const slaCheck = this.checkSLA(vendor.sla_caps, scenario);

      return {
        vendor_id: vendor.id,
        vendor_name: vendor.name,
        monthly_cost: convertedCost,
        annual_cost: convertedCost * 12,
        effective_cost_per_ticket: projectedTickets > 0 ? convertedCost / projectedTickets : 0,
        currency: scenario.currency,
        meets_sla: slaCheck.meets,
        sla_gaps: slaCheck.gaps,
        notes: vendor.notes || '',
        __meta: {
          assumptions: {
            projected_monthly_tickets: projectedTickets,
            projected_cloud_spend: projectedSpend,
            coverage_multiplier: coverageMultiplier
          },
          currency: scenario.currency,
          notes: vendor.notes,
          meets_sla: slaCheck.meets,
          sla_gaps: slaCheck.gaps
        }
      };
    },

    /**
     * Project ticket volume with growth
     */
    projectTickets: function(baseTickets, growthPercent, months) {
      if (months <= 1) return baseTickets;
      const monthlyRate = growthPercent / 100;
      return baseTickets * Math.pow(1 + monthlyRate, months - 1);
    },

    /**
     * Project cloud spend with growth
     */
    projectSpend: function(baseSpend, growthPercent, months) {
      if (months <= 1) return baseSpend;
      const monthlyRate = growthPercent / 100;
      return baseSpend * Math.pow(1 + monthlyRate, months - 1);
    },

    /**
     * Get coverage multiplier based on required vs offered coverage
     */
    getCoverageMultiplier: function(required, offered) {
      const coverageHours = {
        'business': 40,
        '16x5': 80,
        '24x7': 168
      };
      
      const reqHours = coverageHours[required] || 168;
      const offHours = coverageHours[offered] || 168;
      
      // If vendor doesn't offer enough coverage, apply penalty
      if (offHours < reqHours) {
        return reqHours / offHours;
      }
      return 1;
    },

    /**
     * Calculate tiered pricing based on ticket volume
     */
    calculateTieredCost: function(tickets, thresholds) {
      if (!thresholds || thresholds.length === 0) {
        return 0;
      }

      for (let tier of thresholds) {
        if (tickets <= tier.up_to_tickets) {
          return tier.monthly_fee;
        }
      }
      
      // If exceeds all tiers, use the highest tier
      return thresholds[thresholds.length - 1].monthly_fee;
    },

    /**
     * Calculate per-incident pricing with growth projection
     */
    calculatePerIncidentCost: function(ticketsBySeverity, pricePerIncident, growthPercent, months) {
      let total = 0;
      
      // Project each severity level
      const sev1Projected = this.projectTickets(ticketsBySeverity.sev1 || 0, growthPercent, months);
      const sev2Projected = this.projectTickets(ticketsBySeverity.sev2 || 0, growthPercent, months);
      const sev3Projected = this.projectTickets(ticketsBySeverity.sev3 || 0, growthPercent, months);
      
      if (pricePerIncident.sev1) {
        total += sev1Projected * pricePerIncident.sev1;
      }
      if (pricePerIncident.sev2) {
        total += sev2Projected * pricePerIncident.sev2;
      }
      if (pricePerIncident.sev3) {
        total += sev3Projected * pricePerIncident.sev3;
      }
      
      return total;
    },

    /**
     * Calculate retainer with add-ons
     */
    calculateRetainerCost: function(rules, scenario) {
      let cost = rules.base_retainer || 0;
      
      if (!rules.addons) {
        return cost;
      }
      
      // Language surcharge
      if (rules.addons.extra_language_surcharge && scenario.languages_count > 1) {
        cost += rules.addons.extra_language_surcharge * (scenario.languages_count - 1);
      }
      
      // Phone support fee
      if (rules.addons.phone_support_fee && scenario.channels && scenario.channels.includes('phone')) {
        cost += rules.addons.phone_support_fee;
      }
      
      // 24x7 uplift percentage
      if (rules.addons['24x7_uplift_percent'] && scenario.hours_of_coverage === '24x7') {
        cost *= (1 + rules.addons['24x7_uplift_percent'] / 100);
      }
      
      // Channel mix adjustments
      if (rules.addons.channel_mix_adjustments && scenario.channel_mix_percent) {
        const mix = scenario.channel_mix_percent;
        const adjustments = rules.addons.channel_mix_adjustments;
        
        if (mix.email && adjustments.email) {
          cost += adjustments.email * (mix.email / 100);
        }
        if (mix.chat && adjustments.chat) {
          cost += adjustments.chat * (mix.chat / 100);
        }
        if (mix.phone && adjustments.phone) {
          cost += adjustments.phone * (mix.phone / 100);
        }
      }
      
      return cost;
    },

    /**
     * Convert currency using exchange rates
     */
    convertCurrency: function(amount, fromCurrency, toCurrency, rates) {
      if (fromCurrency === toCurrency) return amount;
      
      if (!rates || !rates[fromCurrency] || !rates[toCurrency]) {
        console.warn('Missing exchange rates, returning original amount');
        return amount;
      }
      
      const fromRate = rates[fromCurrency];
      const toRate = rates[toCurrency];
      
      // Convert to base currency (USD) then to target
      const baseAmount = amount / fromRate;
      return baseAmount * toRate;
    },

    /**
     * Check SLA compliance
     */
    checkSLA: function(vendorSLA, scenario) {
      const gaps = [];
      
      if (!vendorSLA) {
        return { meets: false, gaps: ['No SLA information provided'] };
      }
      
      // Check response times
      const reqResp = scenario.required_response_SLA_minutes;
      const vendorResp = vendorSLA.response_minutes_by_sev;
      
      if (reqResp && vendorResp) {
        if (reqResp.sev1 && vendorResp.sev1 && vendorResp.sev1 > reqResp.sev1) {
          gaps.push(`Sev1 response: requires ${reqResp.sev1}min, offers ${vendorResp.sev1}min`);
        }
        if (reqResp.sev2 && vendorResp.sev2 && vendorResp.sev2 > reqResp.sev2) {
          gaps.push(`Sev2 response: requires ${reqResp.sev2}min, offers ${vendorResp.sev2}min`);
        }
        if (reqResp.sev3 && vendorResp.sev3 && vendorResp.sev3 > reqResp.sev3) {
          gaps.push(`Sev3 response: requires ${reqResp.sev3}min, offers ${vendorResp.sev3}min`);
        }
      }
      
      // Check resolution times
      const reqRes = scenario.required_resolution_SLA_hours;
      const vendorRes = vendorSLA.resolution_hours_by_sev;
      
      if (reqRes && vendorRes) {
        if (reqRes.sev1 && vendorRes.sev1 && vendorRes.sev1 > reqRes.sev1) {
          gaps.push(`Sev1 resolution: requires ${reqRes.sev1}h, offers ${vendorRes.sev1}h`);
        }
        if (reqRes.sev2 && vendorRes.sev2 && vendorRes.sev2 > reqRes.sev2) {
          gaps.push(`Sev2 resolution: requires ${reqRes.sev2}h, offers ${vendorRes.sev2}h`);
        }
        if (reqRes.sev3 && vendorRes.sev3 && vendorRes.sev3 > reqRes.sev3) {
          gaps.push(`Sev3 resolution: requires ${reqRes.sev3}h, offers ${vendorRes.sev3}h`);
        }
      }
      
      // Check coverage
      const coverageOrder = { 'business': 1, '16x5': 2, '24x7': 3 };
      const reqCoverage = coverageOrder[scenario.hours_of_coverage] || 3;
      const vendorCoverage = coverageOrder[vendorSLA.coverage] || 1;
      
      if (vendorCoverage < reqCoverage) {
        gaps.push(`Coverage: requires ${scenario.hours_of_coverage}, offers ${vendorSLA.coverage}`);
      }
      
      return {
        meets: gaps.length === 0,
        gaps: gaps
      };
    },

    /**
     * Format currency for display
     */
    formatCurrency: function(amount, currency) {
      const symbols = {
        'USD': '$',
        'EUR': '€',
        'GBP': '£'
      };
      
      const symbol = symbols[currency] || currency + ' ';
      const formatted = Math.round(amount).toLocaleString('en-US');
      
      return `${symbol}${formatted}`;
    },

    /**
     * Convert comparison results to table format
     */
    toComparisonTable: function(comparison) {
      if (!comparison || !comparison.results) {
        return [];
      }

      return comparison.results.map(result => ({
        Vendor: result.vendor_name,
        Monthly: this.formatCurrency(result.monthly_cost, result.currency),
        Annual: this.formatCurrency(result.annual_cost, result.currency),
        'Cost/Ticket': this.formatCurrency(result.effective_cost_per_ticket, result.currency),
        'SLA Fit': result.meets_sla ? 'Meets' : 'Gaps',
        Notes: result.notes,
        __meta: result.__meta
      }));
    },

    /**
     * Build monthly cost series for charts
     */
    buildMonthlyCostSeries: function(comparison) {
      if (!comparison || !comparison.results) {
        return { labels: [], data: [], currency: 'USD' };
      }

      return {
        labels: comparison.results.map(r => r.vendor_name),
        data: comparison.results.map(r => r.monthly_cost),
        currency: comparison.results[0]?.currency || 'USD'
      };
    }
  };

  // Export to window
  if (typeof window !== 'undefined') {
    window.SupportEstimator = SupportEstimator;
  }

  // Also support module exports for testing
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = SupportEstimator;
  }
})();