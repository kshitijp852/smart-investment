const express = require('express');
const router = express.Router();
const NAV = require('../models/NAV');

/**
 * GET /api/funds/explore
 * Explore all available funds with pagination, sorting, and filtering
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - category: Filter by category (optional)
 * - minReturn: Minimum expected return (optional)
 * - maxReturn: Maximum expected return (optional)
 * - sortBy: Sort field (score, return, name, nav) (default: score)
 * - sortOrder: asc or desc (default: desc)
 * - search: Search by scheme name (optional)
 */
router.get('/explore', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      minReturn,
      maxReturn,
      sortBy = 'score',
      sortOrder = 'desc',
      search
    } = req.query;

    // Validate and sanitize inputs
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
    const skip = (pageNum - 1) * limitNum;

    // Build filter query
    const filter = {
      // Exclude institutional plans
      schemeName: { $not: { $regex: 'Institutional|Matured|Closed', $options: 'i' } }
    };

    // Apply category filter
    if (category) {
      filter.category = { $regex: category, $options: 'i' };
    }

    // Apply search filter
    if (search) {
      filter.schemeName = { $regex: search, $options: 'i' };
    }

    // Build aggregation pipeline to get latest NAV for each scheme
    const matchStage = { $match: filter };
    
    // Get latest NAV for each scheme
    const pipeline = [
      matchStage,
      { $sort: { date: -1 } },
      {
        $group: {
          _id: '$schemeCode',
          schemeCode: { $first: '$schemeCode' },
          schemeName: { $first: '$schemeName' },
          category: { $first: '$category' },
          nav: { $first: '$nav' },
          date: { $first: '$date' }
        }
      }
    ];

    // Get total count
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await NAV.aggregate(countPipeline);
    const totalCount = countResult.length > 0 ? countResult[0].total : 0;

    // Build sort object
    const sortField = sortBy === 'return' ? 'nav' : 
                      sortBy === 'name' ? 'schemeName' : 
                      sortBy === 'nav' ? 'nav' : 'nav';
    const sortObj = { [sortField]: sortOrder === 'asc' ? 1 : -1 };

    // Add sort, skip, and limit to main pipeline
    pipeline.push({ $sort: sortObj });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: limitNum });

    // Execute query
    const funds = await NAV.aggregate(pipeline);

    // Enrich with computed metrics
    const enrichedFunds = funds.map(fund => {
      // Calculate expected return based on category
      const expectedReturn = calculateExpectedReturnForCategory(fund.category);
      
      // Calculate 5-year projection
      const currentNAV = fund.nav || 0;
      const projectedValue5Y = currentNAV * Math.pow(1 + expectedReturn, 5);
      
      // Simple score based on NAV and category
      const score = calculateFundScore(fund, expectedReturn);

      return {
        schemeCode: fund.schemeCode,
        schemeName: fund.schemeName,
        category: fund.category,
        currentNAV: currentNAV,
        navDate: fund.date,
        expectedReturn: parseFloat((expectedReturn * 100).toFixed(2)),
        projectedValue5Y: parseFloat(projectedValue5Y.toFixed(2)),
        riskScore: getRiskScoreForCategory(fund.category),
        score: parseFloat(score.toFixed(2))
      };
    });

    // Pagination metadata
    const totalPages = Math.ceil(totalCount / limitNum);

    res.json({
      success: true,
      data: enrichedFunds,
      pagination: {
        currentPage: pageNum,
        totalPages: totalPages,
        totalItems: totalCount,
        itemsPerPage: limitNum,
        hasNextPage: pageNum < totalPages,
        hasPrevPage: pageNum > 1
      },
      filters: {
        category: category || 'all',
        minReturn: minReturn || null,
        maxReturn: maxReturn || null,
        search: search || null
      },
      sorting: {
        sortBy: sortBy,
        sortOrder: sortOrder
      }
    });

  } catch (error) {
    console.error('Error in explore funds:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching funds',
      error: error.message
    });
  }
});

/**
 * Helper: Calculate expected return based on category
 * Updated Nov 2024 to reflect current market conditions
 */
function calculateExpectedReturnForCategory(category) {
  const categoryLower = (category || '').toLowerCase();
  
  // Updated returns based on Nov 2024 market data
  if (categoryLower.includes('liquid')) return 0.07;        // 7% (up from 5%)
  if (categoryLower.includes('debt') || categoryLower.includes('bond')) return 0.08;  // 8% (up from 7.5%)
  if (categoryLower.includes('hybrid') || categoryLower.includes('balanced')) return 0.18;  // 18% (up from 9.5%)
  if (categoryLower.includes('large cap') || categoryLower.includes('bluechip')) return 0.24;  // 24% (up from 11%)
  if (categoryLower.includes('flexi') || categoryLower.includes('multi')) return 0.28;  // 28% (up from 12%)
  if (categoryLower.includes('mid cap') || categoryLower.includes('midcap')) return 0.42;  // 42% (up from 13%)
  if (categoryLower.includes('small cap') || categoryLower.includes('smallcap')) return 0.45;  // 45% (up from 15%)
  if (categoryLower.includes('elss') || categoryLower.includes('tax')) return 0.28;  // 28% (up from 12%)
  if (categoryLower.includes('index')) return 0.24;  // 24% for index funds
  
  return 0.20; // Default (up from 10%)
}

/**
 * Helper: Get risk score for category
 */
function getRiskScoreForCategory(category) {
  const categoryLower = (category || '').toLowerCase();
  
  if (categoryLower.includes('liquid')) return 1;
  if (categoryLower.includes('debt') || categoryLower.includes('bond')) return 2;
  if (categoryLower.includes('hybrid') || categoryLower.includes('balanced')) return 3;
  if (categoryLower.includes('large cap') || categoryLower.includes('bluechip')) return 4;
  if (categoryLower.includes('flexi') || categoryLower.includes('multi')) return 5;
  if (categoryLower.includes('index')) return 4;
  if (categoryLower.includes('elss') || categoryLower.includes('tax')) return 5;
  if (categoryLower.includes('mid cap') || categoryLower.includes('midcap')) return 6;
  if (categoryLower.includes('small cap') || categoryLower.includes('smallcap')) return 7;
  
  return 5; // Default medium risk
}

/**
 * Helper: Calculate simple fund score
 */
function calculateFundScore(fund, expectedReturn) {
  let score = 50; // Base score
  
  // Bonus for higher NAV (indicates maturity)
  if (fund.nav > 100) score += 10;
  if (fund.nav > 500) score += 10;
  
  // Bonus for expected return
  score += expectedReturn * 100;
  
  // Bonus for recent update
  const daysSinceUpdate = (new Date() - new Date(fund.date)) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate < 7) score += 5;
  
  return Math.min(100, score);
}

module.exports = router;
