const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const app = express();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// System prompts and knowledge base - FULL CONTENT
const SYSTEM_PROMPT = `You are a virtual assistant trained to act as an internal order coordinator at Nisko, a lighting manufacturing company. Your role is to fully replace a human office clerk by analyzing raw supplier order texts extracted from PDF files. Based on your internal knowledge base, extract all relevant product and order details needed to produce an accurate and complete work order.

You must:
\t1.\tInterpret technical product terms based on internal guidelines and mappings.
\t2.\tIdentify if the order includes delivery to customer (אספקה ללקוח). If yes, extract the delivery address and contact person, and include them in the output JSON under the relevant order object.
\t3.\tFlag any missing or ambiguous data explicitly.
\t4.\tProvide clear, concise instructions in fluent Hebrew.
\t5.\tReturn a structured JSON object using English field names, with values exactly as written in Hebrew in the source text.

⸻ CRITICAL RULES ⸻

**🚨 MANDATORY: Extract ALL Order Information to Notes**
Profile notes appear in lines BELOW each profile in the order table:
- Look for lines that come after a profile line until the next profile starts
- These sub-lines often have price 0.00 or no price
- Include EVERYTHING from these sub-lines:
  - Unit breakdowns
  - Quote numbers
  - Delivery info
  - Sketches
  - Technical specifications
  - Reference numbers or codes
  - Location descriptions
  - ANY text that appears in these sub-lines

Example: If profile appears in line 1, collect ALL information from lines 2,3,4... until next profile starts
NEVER ignore ANY detail from the order!

**🚨 MANDATORY: Calculate Accessory Prices**  
- Hanging kit: price = total_meters × 20
- Dimming: price = total_meters × 100
NEVER use "0.00" for accessories!

**🚨 CRITICAL: Client Name Identification**
- Client name is NEVER "ניסקו" or "Nisko" - this is YOUR company!
- Look for the actual customer name in the document header, sender details, or company letterhead
- Search thoroughly in the document for customer identification
- If unclear, return "UNSURE" but NEVER use Nisko as client name

**🚨 CRITICAL: Identical Profile Consolidation Rules**
When you see multiple identical profile lines:
- **FIRST: Check if identical profiles form a groove (see Groove Direction section below)**
- If not groove: Check if profiles have EXACTLY the same specifications (name, color, LED tone, etc.)
- If identical: consolidate into one profile object
- Set quantity = number of identical lines
- Set length = the length value that appears in the quantity/length column
- Example: 2 identical lines each showing "3.00" → quantity: 2, length: "3 מטר"

**🚨 EXCEPTION: Groove Profiles**
Before applying standard consolidation rules, check if identical profiles form a groove:
- Two identical consecutive profiles + groove indicators (keywords/sketch) = GROOVE
- Apply groove consolidation rules instead of standard consolidation
- This takes priority over standard identical profile consolidation

**🚨 HELPFUL: Use Sketches and Drawings**
- Pay attention to attached sketches and drawings in the order
- Use them to better understand profile configurations and installations
- Include sketch references in notes when relevant

⸻

Profile Type Classification (External vs Recessed) - Terminology Recognition:
When analyzing profiles, use the following terminology mappings to classify profile installation type:

**External/Surface-Mounted Profiles (חיצוני):**
\t•\tעה"ט (על הטח)
\t•\tללא כנפיים
\t•\tללא שוליים
\t•\tצמוד

**Recessed Profiles (שקוע):**
\t•\tתה"ט (תוך הטח)
\t•\tעם כנפיים
\t•\tעם שוליים

If any of these terms appear in the order text, classify the profile accordingly:
\t•\tDetection of עה"ט/ללא כנפיים/ללא שוליים/צמוד → classify as חיצוני (external)
\t•\tDetection of תה"ט/עם כנפיים/עם שוליים → classify as שקוע (recessed)

This classification should be used when constructing the profile name and determining the appropriate catalog number.

⸻

Profile Type Determination (PCB vs Non-PCB):
If the profile type is not explicitly stated as "PCB" in the text, you must determine PCB status by checking the profile name against the pcb_profiles_table.md:
\t•\tMatch found → treat as valid PCB.
\t•\tNo match or explicitly SMD/COB/etc → treat as non-PCB.

⸻

Catalog Number Resolution – Use Internal Mapping Only:
You must always determine the catalog_number using the internal file pcb_catalog_numbers.md. This file is the sole authoritative source for matching profile data to catalog numbers.

To identify the correct catalog number:
\t•\tCross-reference profile type (e.g., שקוע, חיצוני)
\t•\tColor (e.g., לבן, שחור)
\t•\tLED tone (e.g., 3000K, 4000K, 5000K)
\t•\tDimension or suffix (e.g., 35/35, 40/50, מרחף 1.5 מ׳, etc.)

Even if a catalog number is written explicitly in the input text, you must ignore it if a more accurate match is available in the catalog file.

If no exact match is found in pcb_catalog_numbers.md, return:
"catalog_number": "UNSURE"
and make sure to include "catalog_number" under "missing_fields".
Do not infer, guess, or fabricate catalog numbers under any circumstances.

⸻

LED Color Tone Standardization:
For all PCB profiles, any LED color tone of 6000K or 6500K must be automatically converted to 5000K:
\t•\tWhen extracting led_color from text showing 6000K or 6500K → return "5000K"
\t•\tWhen matching catalog numbers, treat 6000K/6500K as 5000K for lookup purposes
\t•\tThis conversion applies to both profile naming and catalog number resolution

⸻

Filtering Non-PCB Profiles:
You must only extract data for profiles identified as PCB:
\t•\tFor non-PCB profiles, return only:
{
"name": "…",
"skipped_reason": "not_pcb_profile"
}
\t•\tDo not extract or infer other fields (catalog number, color, length, etc.) for these profiles.

⸻

Accessory Products - Automatic Addition:
When certain accessories are mentioned in the order text, automatically add them as separate profile objects:

**Hanging Kit (סט תליה):**
When any of these terms appear: "סט תליה", "כבל תליה", "תוספת תליה", "אביזרי תלייה"
Add this object:
\`\`\`json
{
  "name": "תוספת תליה לפרופיל",
  "catalog_number": "6972",
  "quantity": [extract from order text if specified, otherwise use 1],
  "price": [20 * quantity],
  "color": null,
  "notes": null,
  "missing_fields": []
}
\`\`\`

**Dimming Addition (תוספת דימור):**
When dimming is mentioned: "דימר", "תוספת דימור", "דמר"
Add this object:
\`\`\`json
{
  "name": "תוספת דימור",
  "catalog_number": "9387",
  "quantity": [extract from order text if specified, otherwise use 1],
  "price": [100 * quantity],
  "color": null,
  "notes": null,
  "missing_fields": []
}
\`\`\`

⸻

Profile Naming – Dimensions Preservation
When constructing the "name" field for each profile, always preserve the full descriptor from the original text, including structural or dimensional suffixes such as "35/35", "40/50", "50/70", etc.
These indicators are critical for differentiating between product variants and must never be omitted.

For example:
\t•\t"פרופיל שקוע לבן 35/35" → name = "פרופיל שקוע לבן 35/35"
\t•\t"פרופיל חיצוני שחור 40/50" → name = "פרופיל חיצוני שחור 40/50"

If the suffix is separated on the next line (e.g., "3000K 35/35"), make sure to merge and attach it to the profile name.

⸻

 Hung Classification – Fixed Options Only (Revised)

The hung field must always return one of the following four fixed Hebrew values only:
\t1.\t"תלוי - חיצוני"
\t2.\t"לא תלוי - חיצוני"
\t3.\t"שקוע - תוספת תלייה"
\t4.\t"שקוע"

Classification Logic:
\t1.\tFirst, check whether the profile requires hanging elements, such as:
\t•\t"כולל כבל תליה"
\t•\t"תוספת תליה"
\t•\t"אביזרי תלייה"
\t•\tAny other indication that hanging support is included or required
\t2.\tThen, based on the profile type (recessed = שקוע, external = חיצוני):
\t•\tIf hanging is required and the profile is recessed → return "שקוע - תוספת תלייה"
\t•\tIf hanging is required and the profile is external/surface-mounted → return "תלוי - חיצוני"
\t•\tIf no hanging is mentioned and the profile is external → return "לא תלוי - חיצוני"
\t•\tIf no hanging is mentioned and the profile is recessed → return "שקוע"

Do not return free-text values or alternatives. Use only the four fixed options.
If uncertain, use "שקוע" only when the profile is clearly recessed and no mention of hanging is present.

⸻

Groove Direction & Profile Consolidation:
Groove profiles are L-shaped profiles that may appear as:
1. Single line with groove measurements already specified
2. Two identical profile lines that form one groove (requires consolidation)

**Groove Detection Rules:**
- Check for keywords: "גרונג", "זווית", "צורת ר", "90 מעלות", "לפי סקיצה"
- **PRIORITY: Check attached sketches for L-shaped configurations**
- Look for two consecutive identical profiles (same specs, color, LED tone)
- Verify logical length relationship between segments

**When Groove is Identified:**
- If single line with measurements → use as-is, extract groove_direction
- If two identical lines → **CONSOLIDATE into one profile:**
  * quantity = 1
  * length = sum of both lengths (e.g., "1.5 מטר" + "2 מטר" = "3.5 מטר")
  * price = sum of both prices
  * groove_direction = "גרונג [length1]*[length2]" (e.g., "גרונג 1.5*2")
  * Add note: "מאוחד משתי שורות - פרופיל גרונג לפי סקיצה"
  * Use specifications from the first profile line

**Measurement Extraction:**
- From sketch: Use measurements shown on each segment
- From text: Extract from product descriptions or notes
- From consolidation: Use the individual lengths before summing

**If not groove profile:** return "UNSURE"

⸻

Power Connection Position - Enhanced Rules:
This field reflects the physical location of the electrical input on the profile with detailed positioning when available.

**Extraction Priority (in order):**

**Priority 1: Attached Sketches (PRIMARY SOURCE)**
- Look for electrical connection symbols (circles, arrows, dots, power indicators)
- **Extract the exact distance/measurement as written in the sketch**
- For groove profiles: identify which segment the connection is on
- Never measure or calculate - only copy what is explicitly written

**Priority 2: Order Text/Notes**
- Look for specific positioning in product notes or comments
- Extract phrases like: "הזנה לאחר X סמ/מטר", "חיבור חשמל במרחק של...", "נקודת הזנה ב..."
- **Copy the exact Hebrew text as it appears**

**Priority 3: General Terms (fallback only)**
- Use "באמצע" (center) or "בקצה" (edge) only when no specific positioning is available
- **Default to "בקצה" if connection position is not mentioned at all**
- **For groove profiles without specific positioning: also default to "בקצה"**

**Output Format:**

**For regular profiles:**
- Specific: "לאחר 50 סמ" / "במרחק 1.2 מטר מהקצה"
- General: "באמצע" / "בקצה"

**For groove profiles:**
- Specific: "לאחר 50 סמ בצלע 1.5" / "במרחק 80 סמ בצלע 2.5"
- General: "בקצה בצלע 1.5" / "באמצע בצלע 2.5"

**Groove-Specific Rules:**
- When groove profile has specific connection positioning, always include which segment
- Use the groove measurements to identify segments: "בצלע [measurement]"
- Example: For "גרונג 1.5*2.5" with connection shown on shorter segment → "בצלע 1.5"

**Critical:** Never invent, measure, or calculate positioning. Only extract what is explicitly shown or written. **Exception: Using "בקצה" as default when no positioning information is available is standard practice, not fabrication.**

⸻

Length Field – Always in Meters
The length field must always be returned in meters; convert any centimeter values (e.g., "90") to meters (e.g., 0.9) and round to one decimal place.

⸻

Profile Notes Extraction:
If a product line includes additional remarks in the order (e.g., driver included, dimmable, accessories), extract the exact Hebrew text of that remark and include it in the notes field of the profile's JSON object. If no remarks are present, set "notes": null.

⸻

Delivery Classification - End Customer Only (Enhanced):
The delivery field should only be set to true for deliveries to END CUSTOMERS who are purchasing the profiles, not to branches, warehouses, or intermediate locations.

**Set delivery.is_required = true ONLY when:**
\t•\tText explicitly mentions delivery to an end customer's specific address
\t•\tAddress appears to be a private residence, business location, or project site (not a branch/warehouse)
\t•\tContains end-customer delivery indicators (see keywords below)

**End-Customer Delivery Keywords (Positive Indicators):**
\t•\t"אספקה ללקוח" / "משלוח ללקוח"
\t•\t"כתובת הלקוח" / "אתר הלקוח"
\t•\t"פרויקט של" / "עבור פרויקט"
\t•\t"למיקום העבודה" / "לאתר ההתקנה"
\t•\t"כתובת ההתקנה"
\t•\tContact person mentioned for the delivery location

**Set delivery.is_required = false when:**
\t•\tDelivery is to company branches (סניף)
\t•\tDelivery is to warehouses (מחסן) or distribution centers (מרכז הפצה)
\t•\tContains branch/warehouse indicators: "משרד", "מפעל", "חברת" + [company name]
\t•\tNo specific delivery instructions are mentioned
\t•\tDelivery is for internal company operations

**Multiple Addresses Detected:**
If multiple potential delivery addresses are identified:
\t•\tSet delivery.is_required = "UNSURE"
\t•\tIn address field: list all identified addresses with format "זוהו מספר כתובות: 1) [address1] 2) [address2]"
\t•\tDo NOT include branch addresses in this list - only potential end-customer addresses

**Critical Rules:**
\t•\tBranch addresses (containing סניף/משרד/מפעל) should NEVER be considered delivery addresses
\t•\tWhen in doubt between end-customer and branch delivery → set to false
\t•\tAlways prioritize clear end-customer indicators over ambiguous addresses

⸻

Branch Extraction (New Section)

The branch field represents the client's operational location for this order.
\t•\tIf the order document explicitly mentions a branch name or number (e.g., "סניף ראשון לציון", or "Branch 2") – use that value directly.
\t•\tIf no branch is mentioned, default to the customer delivery address (כתובת למשלוח), as it typically reflects the operational site.
\t•\tIf neither branch nor address is present in the text, return "UNSURE".

The branch field must never be left empty. Use "UNSURE" only as a last resort.

⸻

Critical Extraction Rules

No Hallucinated Values:
You must never fabricate or infer values that do not explicitly appear in the source text or cannot be verified using internal mappings.
For example:
\t•\tIf catalog_number cannot be resolved using the internal map — return "UNSURE" and include under missing_fields.
\t•\t**Exception: power_connection_position defaults to "בקצה" when not specified - this is standard practice, not fabrication.**

⸻

Handling Multiple Products and Orders:
\t•\tEach product = separate object under profiles.
\t•\tEach order = separate object under orders.
\t•\tDo not merge lines even if the product is identical. Variations in quantity or connection must be preserved.

⸻

Order Validation:
If the content is not a valid supplier order (e.g., price quote, drawing), return:
{
"status": "not_an_order"
}

⸻

Profile Structure:
\t•\tEach profile includes full field set.
\t•\tAll profiles are grouped under "profiles" in the JSON.
\t•\tOrder-level values (order_number, client_name) appear only once.

⸻

Missing Values:
If a value is unclear, ambiguous, or low confidence, return "UNSURE" and list it in missing_fields.
Never guess.

⸻

Client Name:
Extract directly from sender details.
Never guess or substitute alternate client names.
It NEVER can be Nisko.

⸻

Price Logic:
Price = full line price (unit price × quantity).
Do not use unit price.

⸻

Quantity Logic:
\t•\tIf only total meters are listed → that is the quantity.
\t•\tIf breakdown of units and length is listed → multiply accordingly.

⸻

Marlog Tzrifin:
Any reference to "מרלוג צריפין" refers to Nisko and must not be interpreted as client info or delivery address.

⸻

Output Format Example:
{
  "orders": [
    {
      "order_number": "79501",
      "order_date": "20/06/2025",
      "client_name": "חשמל ישיר בע\\"מ",
      "branch": "2",
      "delivery": {
        "is_required": false,
        "address": null,
        "contact_person": null
      },
      "profiles": [
        {
          "name": "פרופיל שקוע לבן 35/35",
          "catalog_number": "16967",
          "led_color": "3000K",
          "led_type": "PCB",
          "length": "1 מטר",
          "quantity": 3,
          "price": "450.00",
          "color": "לבן",
          "groove_direction": "UNSURE",
          "hung": "שקוע",
          "power_connection_position": "בקצה",
          "notes": null,
          "missing_fields": ["groove_direction"]
        },
        {
          "name": "פרופיל חיצוני שחור 40/50",
          "catalog_number": "5589",
          "led_color": "3000K",
          "led_type": "PCB",
          "length": "1 מטר",
          "quantity": 2,
          "price": "340.00",
          "color": "שחור",
          "groove_direction": "UNSURE",
          "hung": "לא תלוי - חיצוני",
          "power_connection_position": "בקצה",
          "notes": null,
          "missing_fields": ["groove_direction"]
        },
        {
          "name": "תוספת תליה לפרופיל",
          "catalog_number": "6972",
          "quantity": 2,
          "price": "40.00",
          "color": null,
          "notes": null,
          "missing_fields": []
        },
        {
          "name": "פרופיל SMD לבן 24V",
          "skipped_reason": "not_pcb_profile"
        }
      ]
    }
  ]
}


All field values must remain in their original Hebrew form as they appear in the input text.`;

const CATALOG_NUMBERS = `| Catalog Number | Description                                     |
|----------------|-------------------------------------------------|
| 5580           | 40/50 חיצוני לבן 3K                            |
| 5582           | 40/50 חיצוני לבן 4K                            |
| 5588           | 40/50 חיצוני לבן 5K                            |
| 5589           | 40/50 חיצוני שחור 3K                           |
| 5593           | 40/50 חיצוני שחור 4K                           |
| 5595           | 40/50 חיצוני שחור 5K                           |
| 5599           | 40/50 שקוע לבן 3K                              |
| 5605           | 40/50 שקוע לבן 4K                              |
| 5606           | 40/50 שקוע לבן 5K                              |
| 5610           | 40/50 שקוע שחור 3K                             |
| 5618           | 40/50 שקוע שחור 4K                             |
| 5625           | 40/50 שקוע שחור 5K                             |
| 8077           | טריגון שקוע לבן 3K 30W                         |
| 8080           | טריגון שקוע לבן 3K 60W                         |
| 8078           | טריגון שקוע לבן 4K 30W                         |
| 8081           | טריגון שקוע לבן 4K 60W                         |
| 8079           | טריגון שקוע לבן 5K 30W                         |
| 8088           | טריגון שקוע לבן 5K 60W                         |
| 3605           | סקיני 50 שקוע שחור 3K                          |
| 6345           | סקיני 50 שקוע שחור 4K                          |
| 6347           | סקיני 50 שקוע שחור 5K                          |
| 6275           | סקיני 50 שקוע לבן 3K                           |
| 6276           | סקיני 50 שקוע לבן 4K                           |
| 6278           | סקיני 50 שקוע לבן 5K                           |
| 20078          | פרופיל אולטרא שקוע לבן 3K                     |
| 20079          | פרופיל אולטרא שקוע לבן 4K                     |
| 20080          | פרופיל אולטרא שקוע לבן 5K                     |
| 20081          | פרופיל אולטרא שקוע שחור 3K                    |
| 20082          | פרופיל אולטרא שקוע שחור 4K                    |
| 20083          | פרופיל אולטרא שקוע שחור 5K                    |
| 7491           | פרופיל אולטרא חיצוני לבן 4K                   |
| 7492           | פרופיל אולטרא חיצוני לבן 5K                   |
| 7487           | פרופיל אולטרא חיצוני שחור 3K                  |
| 7488           | פרופיל אולטרא חיצוני שחור 4K                  |
| 7489           | פרופיל אולטרא חיצוני שחור 5K                  |
| 1027           | פרופיל גארד שחור 3K                           |
| 1028           | פרופיל גארד שחור 4K                           |
| 1032           | פרופיל גארד שחור 5K                           |
| 5887           | פרופיל גארד לבן 3K                            |
| 5888           | פרופיל גארד לבן 4K                            |
| 5890           | פרופיל גארד לבן 5K                            |
| 16931          | 50/70 שקוע לבן 3K                             |
| 16932          | 50/70 שקוע לבן 4K                             |
| 16933          | 50/70 שקוע לבן 5K                             |
| 16934          | 50/70 שקוע שחור 3K                            |
| 16935          | 50/70 שקוע שחור 4K                            |
| 16936          | 50/70 שקוע שחור 5K                            |
| 16940          | 50/70 חיצוני לבן 3K                           |
| 16941          | 50/70 חיצוני לבן 4K                           |
| 16942          | 50/70 חיצוני לבן 5K                           |
| 16943          | 50/70 חיצוני שחור 3K                          |
| 16944          | 50/70 חיצוני שחור 4K                          |
| 16945          | 50/70 חיצוני שחור 5K                          |
| 16967          | 35/35 שקוע לבן 3K                             |
| 16968          | 35/35 שקוע לבן 4K                             |
| 16969          | 35/35 שקוע לבן 5K                             |
| 16970          | 35/35 שקוע שחור 3K                            |
| 16971          | 35/35 שקוע שחור 4K                            |
| 16972          | 35/35 שקוע שחור 5K                            |
| 16994          | סקיני 60 שקוע לבן 3000K                       |
| 16995          | סקיני 60 שקוע לבן 4000K                       |
| 16996          | סקיני 60 שקוע לבן 5000K                       |
| 16997          | סקיני 60 שקוע שחור 3000K                      |
| 16998          | סקיני 60 שקוע שחור 4000K                      |
| 16999          | סקיני 60 שקוע שחור 5000K                      |
| 17030          | פס דין לבן 3000K                              |
| 17031          | פס דין לבן 4000K                              |
| 17032          | פס דין לבן 5000K                              |
| 17033          | פס דין שחור 3000K                             |
| 17034          | פס דין שחור 4000K                             |
| 17035          | פס דין שחור 5000K                             |
| 20910          | 8 כפול שקוע לבן PCB 3K                        |
| 20911          | 8 כפול שקוע לבן PCB 4K                        |
| 20912          | 8 כפול שקוע לבן PCB 5K                        |
| 20913          | 8 כפול שקוע שחור PCB 3K                       |
| 20914          | 8 כפול שקוע שחור PCB 4K                       |
| 20915          | 8 כפול שקוע שחור PCB 5K                       |
| 17113          | אפ דאון שחור 3K                               |
| 17114          | אפ דאון שחור 4K                               |
| 17115          | אפ דאון שחור 5K                               |
| 17116          | אפ דאון לבן 3K                                |
| 17117          | אפ דאון לבן 4K                                |
| 17118          | אפ דאון לבן 5K                                |
| 17119          | פרופיל דאון לבן 3000K                        |
| 17120          | פרופיל דאון לבן 4000K                        |
| 17121          | פרופיל דאון לבן 5000K                        |
| 17122          | פרופיל דאון שחור 3000K                       |
| 17123          | פרופיל דאון שחור 4000K                       |
| 17124          | פרופיל דאון שחור 5000K                       |
| 17504          | סקיני 60 מרחף 0.75 לבן 3000K                 |
| 17505          | סקיני 60 מרחף 0.75 לבן 4000K                 |
| 17506          | סקיני 60 מרחף 0.75 לבן 5000K                 |
| 20665          | סקיני 60 מרחף 0.75 שחור 3000K                |
| 20666          | סקיני 60 מרחף 0.75 שחור 4000K                |
| 20667          | סקיני 60 מרחף 0.75 שחור 5000K                |
| 17125          | סקיני 60 מרחף 1.5 מ לבן 3000K                |
| 17126          | סקיני 60 מרחף 1.5 מ לבן 4000K                |
| 17127          | סקיני 60 מרחף 1.5 מ לבן 5000K                |
| 17128          | סקיני 60 מרחף 1.5 מ שחור 3000K               |
| 17129          | סקיני 60 מרחף 1.5 מ שחור 4000K               |
| 17130          | סקיני 60 מרחף 1.5 מ שחור 5000K               |
| 17131          | סקיני 60 מרחף 2.25 מ לבן 3000K               |
| 17132          | סקיני 60 מרחף 2.25 מ לבן 4000K               |
| 17133          | סקיני 60 מרחף 2.25 מ לבן 5000K               |
| 17134          | סקיני 60 מרחף 2.25 מ שחור 3000K              |
| 17135          | סקיני 60 מרחף 2.25 מ שחור 4000K              |
| 17136          | סקיני 60 מרחף 2.25 מ שחור 5000K              |
| 18063          | סקיני 40 מרחף 0.71 לבן 3000K                 |
| 18064          | סקיני 40 מרחף 0.71 לבן 4000K                 |
| 18065          | סקיני 40 מרחף 0.71 לבן 5000K                 |
| 18066          | סקיני 40 מרחף 0.71 שחור 3000K                |
| 18067          | סקיני 40 מרחף 0.71 שחור 4000K                |
| 18068          | סקיני 40 מרחף 0.71 שחור 5000K                |
| 18069          | סקיני 40 מרחף 1.48 לבן 3000K                 |
| 18070          | סקיני 40 מרחף 1.48 לבן 4000K                 |
| 18071          | סקיני 40 מרחף 1.48 לבן 5000K                 |
| 18072          | סקיני 40 מרחף 1.48 שחור 3000K                |
| 18073          | סקיני 40 מרחף 1.48 שחור 4000K                |
| 18074          | סקיני 40 מרחף 1.48 שחור 5000K                |
| 18075          | סקיני 40 מרחף 2.25 לבן 3000K                 |
| 18076          | סקיני 40 מרחף 2.25 לבן 4000K                 |
| 18077          | סקיני 40 מרחף 2.25 לבן 5000K                 |
| 18078          | סקיני 40 מרחף 2.25 שחור 3000K                |
| 18079          | סקיני 40 מרחף 2.25 שחור 4000K                |
| 18080          | סקיני 40 מרחף 2.25 שחור 5000K                |
| 6972           | תוספת תליה לפרופיל                            |
| 9387           | תוספת לדימור לפרופיל PCB לדים למטר          |`;

const PCB_PROFILES_TABLE = `### טבלת פרופילים מסוג PCB

| שם מוצר             | עוצמה |
| ------------------- | ----- |
| אולטרא חיצוני       | 30W   |
| אולטרא שקוע         | 30W   |
| 40/50 חיצוני        | 30W   |
| 40/50 שקוע          | 30W   |
| 50/70 חיצוני        | 30W   |
| 50/70 שקוע          | 30W   |
| 35/35 שקוע          | 30W   |
| 8 כפול שקוע PCB     | 30W   |
| סקיני 50 שקוע       | 60W   |
| סקיני 60 שקוע       | 60W   |
| אפ -דאון            | 60W   |
| גארד                | 30W   |
| פס דין              | 60W   |
| טריגון 30W          | 30W   |
| סקיני 40 מרחף 0.71מ | 30W   |
| סקיני 40 מרחף 1.48מ | 30W   |
| סקיני 40 מרחף 2.25מ | 30W   |
| סקיני 60 מרחף 0.75מ | 60W   |
| סקיני 60 מרחף 1.5מ  | 60W   |
| סקיני 60 מרחף 2.25מ | 60W   |`;

const GROOVE_GUIDE = `### Groove Profile Identification Guide

**What are Groove Profiles:**
Groove profiles are L-shaped profiles that create a 90-degree angle between two segments, forming one continuous lighting fixture. **Important: A groove is always ONE profile, even if it appears as multiple lines in the order.**

**How to Identify Groove Profiles:**

1. **Search for Keywords in Order Text:**
   - "גרונג" / "groove"
   - "זווית" / "פינה" / "זווית ישרה"
   - "צורת ר" / "צורת L"
   - "90 מעלות"
   - References to corner installation
   - "לפי סקיצה" / "ראה ציור" / "סקיצה מצורפת"

2. **Check Attached Sketches/Images (PRIMARY SOURCE):**
   - Look for drawings showing corner installations
   - Identify shapes resembling the letter "ר" (L-shape)
   - Look for 90-degree angle configurations
   - Check for measurement annotations on each segment of the sketch
   - Look for connection points or electrical notation

3. **Identify Multiple Profile Lines That Form One Groove:**
   - Look for identical profile specifications (same type, color, LED tone) 
   - Check if they appear consecutively in the order
   - Verify if sketch shows them as connected segments
   - Total length should logically match the sum of individual segments

4. **Extract Measurements:**
   - Groove profiles have measurements for both segments
   - Format: "X*Y" (e.g., "3*3", "2.5*4", "1.5*1.3")
   - Measurements may appear in order text OR on the sketch
   - **Sketches are the authoritative source for measurements**

**How to Process Groove Profiles:**

**Case 1: Single line already specifies groove:**
- Extract groove_direction as specified
- Use profile data as-is

**Case 2: Two identical profile lines form one groove:**
- **CONSOLIDATE into ONE profile object:**
  * quantity = 1 (always 1 for groove profiles)
  * length = sum of both segment lengths
  * price = sum of both line prices
  * groove_direction = "גרונג [segment1]*[segment2]"
  * notes = "מאוחד משתי שורות - פרופיל גרונג לפי סקיצה"
  * Use all other specifications from the first profile line

**Groove Direction Field Values:**

**For consolidated groove profiles:**
- Return: "גרונג [measurement1]*[measurement2]"
- Example: "גרונג 1.5*2" (for 1.5m + 2m segments)
- Example: "גרונג 3*3" (for equal 3m segments)

**If groove is identified but measurements are unclear:**
- Return: "גרונג"

**If it's not a groove profile:**
- Return: "UNSURE"

**Critical Rules:**
- **A groove is ALWAYS one profile object in the JSON output**
- **Sketches always take priority** over text descriptions
- If there's a contradiction between text and sketch, follow the sketch but note the discrepancy
- If measurements appear only on sketch, extract them from there
- Don't create multiple profile objects for groove segments
- The consolidated groove profile should represent the complete L-shaped fixture

**Power Connection Position for Groove Profiles:**

Since groove profiles consist of two segments, the power connection position must specify both the distance and which segment:

**Extraction Rules:**
1. **From Sketches (Priority):** Look for electrical symbols and extract the exact measurement and segment identification
2. **From Text:** Look for specific positioning notes in the order
3. **Format:** Always include segment identification for groove profiles

**Connection Types:**

**Corner Connection (Special Case):**
- If electrical symbol appears exactly at the junction point between two segments
- If text mentions "פינה", "בחיבור", "בזווית הגרונג", or similar corner references
- Return: "הזנה בגרונג (פינה)"

**Segment-Specific Connection:**
- "לאחר 50 סמ בצלע 1.5" (connection 50cm from start on the 1.5m segment)
- "באמצע בצלע 2.5" (center of the 2.5m segment)
- "בקצה בצלע 1.5" (at the end of the 1.5m segment)

**Segment Identification:**
- Use the measurements from groove_direction to identify segments
- Example: If groove_direction = "גרונג 1.5*2.5", segments are "צלע 1.5" and "צלע 2.5"
- The sketch will show which segment has the connection point

**Critical Notes:**
- Never guess or calculate positions
- Always copy exact measurements from sketches or text
- For groove profiles, segment identification is mandatory when specific positioning is given
- Corner connections take priority over segment-specific positioning`;

// פונקציה ליצירת HTML מהנתונים שחולצו - לפי הדוגמה המדויקת
function generateOrderHTML(orderData, nameRivhitNO = null, client_name = null, rivhitNO = null) {
  if (!orderData || !orderData.orders || orderData.orders.length === 0) {
    return '<p>לא נמצאו הזמנות</p>';
  }

  let html = '';
  
  orderData.orders.forEach((order, orderIndex) => {
    // כותרת עיקרית
    html += `<h2><strong>סיכום הזמנה חדשה - להכנת דף עבודה</strong></h2>\n\n`;
    
    // פרטי הזמנה עיקריים
    if (order.order_date && order.order_date !== 'UNSURE') {
      html += `<p><strong>תאריך הזמנה:</strong> ${order.order_date}</p>\n`;
    }
    
    // שם לקוח עם כרטיס רווחית - 3 מצבים אפשריים
    let clientDisplayName = null;
    let rivhitDisplayNumber = '_______';
    
    if (nameRivhitNO) {
      // מצב 1: name&rivhitNO - נפרק את זה לשם ומספר
      const parts = nameRivhitNO.trim().split(/\s+/);
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          rivhitDisplayNumber = lastPart;
          clientDisplayName = parts.slice(0, -1).join(' ');
        } else {
          clientDisplayName = nameRivhitNO;
        }
      } else {
        clientDisplayName = nameRivhitNO;
      }
    } else if (client_name && rivhitNO) {
      // מצב 2: client_name ו-rivhitNO נפרדים
      clientDisplayName = client_name;
      rivhitDisplayNumber = rivhitNO;
    } else if (order.client_name && order.client_name !== 'UNSURE') {
      // מצב 3: שם מהמסמך
      clientDisplayName = order.client_name;
    }
    
    if (clientDisplayName) {
      html += `<p><strong>שם לקוח:</strong> ${clientDisplayName} - ${rivhitDisplayNumber} (מס כרטיס רווחית)</p>\n`;
    }
    
    if (order.order_number && order.order_number !== 'UNSURE') {
      html += `<p><strong>מס׳ הזמנה (רכש):</strong> ${order.order_number}</p>\n`;
    }
    
    if (order.branch && order.branch !== 'UNSURE') {
      html += `<p><strong>סניף:</strong> ${order.branch}</p>\n`;
    }
    
    html += `\n`;

    // פרופילים
    if (order.profiles && order.profiles.length > 0) {
      let profileCounter = 1;
      
      order.profiles.forEach(profile => {
        // דלג על פרופילים שנדלגו או אביזרים
        if (profile.skipped_reason || 
            (profile.name && (profile.name.includes('תוספת תליה') || profile.name.includes('תוספת דימור')))) {
          return;
        }
        
        html += `<p><strong>פרופיל ${profileCounter}:</strong></p>\n`;
        
        // שם פרופיל
        if (profile.name && profile.name !== 'UNSURE') {
          html += `<p><strong>שם פרופיל:</strong> ${profile.name}</p>\n`;
        }
        
        // מק"ט
        if (profile.catalog_number && profile.catalog_number !== 'UNSURE') {
          html += `<p><strong>מקט:</strong> ${profile.catalog_number}</p>\n`;
        }
        
        // גוון לד
        if (profile.led_color && profile.led_color !== 'UNSURE') {
          html += `<p><strong>גוון לד:</strong> ${profile.led_color}</p>\n`;
        }
        
        // סוג לד
        if (profile.led_type && profile.led_type !== 'UNSURE') {
          html += `<p><strong>סוג לד:</strong> ${profile.led_type}</p>\n`;
        }
        
        // אורך
        if (profile.length && profile.length !== 'UNSURE') {
          html += `<p><strong>אורך:</strong> ${profile.length}</p>\n`;
        }
        
        // כמות
        if (profile.quantity && profile.quantity !== 'UNSURE') {
          html += `<p><strong>כמות:</strong> ${profile.quantity}</p>\n`;
        }
        
        // מחיר
        if (profile.price && profile.price !== 'UNSURE' && profile.price !== '0.00') {
          html += `<p><strong>מחיר:</strong> ${profile.price}₪</p>\n`;
        }
        
        // צבע פרופיל
        if (profile.color && profile.color !== 'UNSURE') {
          html += `<p><strong>צבע פרופיל:</strong> ${profile.color}</p>\n`;
        }
        
        // גרונג
        if (profile.groove_direction && profile.groove_direction !== 'UNSURE') {
          html += `<p><strong>גרונג:</strong> ${profile.groove_direction}</p>\n`;
        } else {
          html += `<p><strong>גרונג:</strong> לא גרונג</p>\n`;
        }
        
        // תלייה
        if (profile.hung && profile.hung !== 'UNSURE') {
          html += `<p><strong>תלייה:</strong> ${profile.hung}</p>\n`;
        }
        
        // נקודת הזנה
        if (profile.power_connection_position && profile.power_connection_position !== 'UNSURE') {
          html += `<p><strong>נקודת הזנה:</strong> ${profile.power_connection_position}</p>\n`;
        }
        
        // הערות נוספות
        if (profile.notes && profile.notes !== null) {
          html += `<p><strong>הערות נוספות ע״ג ההזמנה:</strong> ${profile.notes}</p>\n`;
        }
        
        // שדות חסרים
        if (profile.missing_fields && profile.missing_fields.length > 0) {
          html += `<p><strong>שדות חסרים:</strong> ${profile.missing_fields.join(', ')}</p>\n`;
        }
        
        html += `\n`;
        profileCounter++;
      });
    }
    
    // תוספות (אביזרים)
    const accessories = order.profiles ? order.profiles.filter(p => 
      p.name && (p.name.includes('תוספת תליה') || p.name.includes('תוספת דימור'))
    ) : [];
    
    if (accessories.length > 0) {
      html += `<p><strong>תוספות בהזמנה</strong></p>\n`;
      
      accessories.forEach(accessory => {
        let accessoryLine = '';
        
        if (accessory.name && accessory.name !== 'UNSURE') {
          accessoryLine += `<strong>שם מוצר:</strong> ${accessory.name} `;
        }
        
        if (accessory.catalog_number && accessory.catalog_number !== 'UNSURE') {
          accessoryLine += `<strong>מקט:</strong> ${accessory.catalog_number} `;
        }
        
        if (accessory.quantity && accessory.quantity !== 'UNSURE') {
          accessoryLine += `<strong>כמות:</strong> ${accessory.quantity} `;
        }
        
        if (accessory.price && accessory.price !== 'UNSURE' && accessory.price !== '0.00') {
          accessoryLine += `<strong>מחיר:</strong> ${accessory.price}₪`;
        }
        
        if (accessoryLine) {
          html += `<p>${accessoryLine}</p>\n`;
        }
      });
      
      html += `\n`;
    }
    
    // פרופילים לא PCB
    const nonPcbProfiles = order.profiles ? order.profiles.filter(p => p.skipped_reason === 'not_pcb_profile') : [];
    if (nonPcbProfiles.length > 0) {
      html += `<p><strong>פרופילים נוספים בהזמנה - ללא PCB</strong></p>\n`;
      
      nonPcbProfiles.forEach(profile => {
        if (profile.name && profile.name !== 'UNSURE') {
          html += `<p><strong>שם:</strong> ${profile.name} <strong>הערה:</strong> לא PCB - יש לבדוק ידנית</p>\n`;
        }
      });
      
      html += `\n`;
    }
    
    // הערות של האייג'נט
    html += `<p><strong>הערות נוספות של האייג'נט על ההזמנה</strong></p>\n`;
    
    // בנה רשימת הערות חכמות
    const aiNotes = [];
    
    // בדוק גרונג
    const grooveProfiles = order.profiles ? order.profiles.filter(p => 
      p.groove_direction && p.groove_direction !== 'UNSURE' && p.groove_direction !== 'לא גרונג'
    ) : [];
    
    if (grooveProfiles.length > 0) {
      aiNotes.push('לפי הסקיצה זיהיתי שאחד מהפרופילים הוא בתצורת גרונג');
      aiNotes.push('יש לוודא סקיצה לפני הכנת דף עבודה');
    }
    
    // בדוק פרופילים לא PCB
    if (nonPcbProfiles.length > 0) {
      aiNotes.push('ישנם פרופילים לא מסוג PCB בהזמנה - יש לוודא ידנית');
    }
    
    // בדוק שדות חסרים כלליים
    const allMissingFields = new Set();
    if (order.profiles) {
      order.profiles.forEach(profile => {
        if (profile.missing_fields) {
          profile.missing_fields.forEach(field => allMissingFields.add(field));
        }
      });
    }
    
    if (allMissingFields.size > 0) {
      aiNotes.push(`זוהו שדות חסרים: ${Array.from(allMissingFields).join(', ')}`);
    }
    
    // בדוק משלוח
    if (order.delivery && order.delivery.is_required === true) {
      aiNotes.push('זוהתה דרישת משלוח ללקוח');
      if (order.delivery.address) {
        aiNotes.push(`כתובת משלוח: ${order.delivery.address}`);
      }
    }
    
    // הערות ברירת מחדל
    if (aiNotes.length === 0) {
      aiNotes.push('כל המידע חולץ אוטומטית מהמסמכים המצורפים');
      aiNotes.push('נא לאמת נכונות הפרטים לפני ביצוע ההזמנה');
    }
    
    // הדפס הערות
    aiNotes.forEach(note => {
      html += `<p>* ${note}</p>\n`;
    });
    
  });

  return html;
}

// פונקציה מעודכנת ליצירת HTML מעוצב
function generateStyledOrderHTML(orderData, nameRivhitNO = null, client_name = null, rivhitNO = null) {
  if (!orderData || !orderData.orders || orderData.orders.length === 0) {
    return '<p>לא נמצאו הזמנות</p>';
  }

  let html = '';
  
  orderData.orders.forEach((order, orderIndex) => {
    // כותרת עיקרית עם אייקון
    html += `<h2>🏠 סיכום הזמנה חדשה - להכנת דף עבודה 🏠</h2>\n\n`;
    
    // פרטי הזמנה עיקריים
    html += `<div class="order-info">\n`;
    
    if (order.order_date && order.order_date !== 'UNSURE') {
      html += `<p class="profile-field"><strong>תאריך הזמנה:</strong> ${order.order_date}</p>\n`;
    }
    
    // שם לקוח עם כרטיס רווחית - 3 מצבים אפשריים
    let clientDisplayName = null;
    let rivhitDisplayNumber = '_______';
    
    if (nameRivhitNO) {
      // מצב 1: name&rivhitNO - נפרק את זה לשם ומספר
      const parts = nameRivhitNO.trim().split(/\s+/);
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1];
        if (/^\d+$/.test(lastPart)) {
          rivhitDisplayNumber = lastPart;
          clientDisplayName = parts.slice(0, -1).join(' ');
        } else {
          clientDisplayName = nameRivhitNO;
        }
      } else {
        clientDisplayName = nameRivhitNO;
      }
    } else if (client_name && rivhitNO) {
      // מצב 2: client_name ו-rivhitNO נפרדים
      clientDisplayName = client_name;
      rivhitDisplayNumber = rivhitNO;
    } else if (order.client_name && order.client_name !== 'UNSURE') {
      // מצב 3: שם מהמסמך
      clientDisplayName = order.client_name;
    }
    
    if (clientDisplayName) {
      html += `<p class="profile-field"><strong>שם לקוח:</strong> ${clientDisplayName} - <span class="highlight-value">${rivhitDisplayNumber}</span> (מס כרטיס רווחית)</p>\n`;
    }
    
    if (order.order_number && order.order_number !== 'UNSURE') {
      html += `<p class="profile-field"><strong>מס׳ הזמנה (רכש):</strong> ${order.order_number}</p>\n`;
    }
    
    if (order.branch && order.branch !== 'UNSURE') {
      html += `<p class="profile-field"><strong>סניף:</strong> ${order.branch}</p>\n`;
    }
    
    html += `</div>\n\n`;

    // פרופילים
    if (order.profiles && order.profiles.length > 0) {
      let profileCounter = 1;
      
      order.profiles.forEach(profile => {
        // דלג על פרופילים שנדלגו או אביזרים
        if (profile.skipped_reason || 
            (profile.name && (profile.name.includes('תוספת תליה') || profile.name.includes('תוספת דימור')))) {
          return;
        }
        
        html += `<div class="profile-section">\n`;
        html += `<div class="profile-title">🔄 פרופיל ${profileCounter}:</div>\n`;
        
        // שם פרופיל
        if (profile.name && profile.name !== 'UNSURE') {
          html += `<p class="profile-field"><strong>שם פרופיל:</strong> ${profile.name}</p>\n`;
        }
        
        // מק"ט
        if (profile.catalog_number && profile.catalog_number !== 'UNSURE') {
          html += `<p class="profile-field"><strong>מקט:</strong> ${profile.catalog_number}</p>\n`;
        }
        
        // גוון לד
        if (profile.led_color && profile.led_color !== 'UNSURE') {
          html += `<p class="profile-field"><strong>גוון לד:</strong> ${profile.led_color}</p>\n`;
        }
        
        // סוג לד
        if (profile.led_type && profile.led_type !== 'UNSURE') {
          html += `<p class="profile-field"><strong>סוג לד:</strong> ${profile.led_type}</p>\n`;
        }
        
        // אורך
        if (profile.length && profile.length !== 'UNSURE') {
          html += `<p class="profile-field"><strong>אורך:</strong> ${profile.length}</p>\n`;
        }
        
        // כמות
        if (profile.quantity && profile.quantity !== 'UNSURE') {
          html += `<p class="profile-field"><strong>כמות:</strong> ${profile.quantity}</p>\n`;
        }
        
        // מחיר
        if (profile.price && profile.price !== 'UNSURE' && profile.price !== '0.00') {
          html += `<p class="profile-field"><strong>מחיר:</strong> <span class="currency">${profile.price}₪</span></p>\n`;
        }
        
        // צבע פרופיל
        if (profile.color && profile.color !== 'UNSURE') {
          html += `<p class="profile-field"><strong>צבע פרופיל:</strong> ${profile.color}</p>\n`;
        }
        
        // גרונג
        if (profile.groove_direction && profile.groove_direction !== 'UNSURE') {
          html += `<p class="profile-field"><strong>גרונג:</strong> <span class="highlight-value">${profile.groove_direction}</span></p>\n`;
        } else {
          html += `<p class="profile-field"><strong>גרונג:</strong> לא גרונג</p>\n`;
        }
        
        // תלייה
        if (profile.hung && profile.hung !== 'UNSURE') {
          html += `<p class="profile-field"><strong>תלייה:</strong> ${profile.hung}</p>\n`;
        }
        
        // נקודת הזנה
        if (profile.power_connection_position && profile.power_connection_position !== 'UNSURE') {
          html += `<p class="profile-field"><strong>נקודת הזנה:</strong> ${profile.power_connection_position}</p>\n`;
        }
        
        // הערות נוספות
        if (profile.notes && profile.notes !== null) {
          html += `<p class="profile-field"><strong>הערות נוספות ע״ג ההזמנה:</strong> ${profile.notes}</p>\n`;
        }
        
        // שדות חסרים
        if (profile.missing_fields && profile.missing_fields.length > 0) {
          html += `<p class="profile-field missing-fields"><strong>שדות חסרים:</strong> ${profile.missing_fields.join(', ')}</p>\n`;
        }
        
        html += `</div>\n\n`;
        profileCounter++;
      });
    }
    
    // תוספות (אביזרים)
    const accessories = order.profiles ? order.profiles.filter(p => 
      p.name && (p.name.includes('תוספת תליה') || p.name.includes('תוספת דימור'))
    ) : [];
    
    if (accessories.length > 0) {
      html += `<div class="accessories-section">\n`;
      html += `<div class="section-title accessories-title">➕ תוספות בהזמנה</div>\n`;
      
      accessories.forEach(accessory => {
        let accessoryLine = '';
        
        if (accessory.name && accessory.name !== 'UNSURE') {
          accessoryLine += `<strong>שם מוצר:</strong> ${accessory.name} `;
        }
        
        if (accessory.catalog_number && accessory.catalog_number !== 'UNSURE') {
          accessoryLine += `<strong>מקט:</strong> ${accessory.catalog_number} `;
        }
        
        if (accessory.quantity && accessory.quantity !== 'UNSURE') {
          accessoryLine += `<strong>כמות:</strong> ${accessory.quantity} `;
        }
        
        if (accessory.price && accessory.price !== 'UNSURE' && accessory.price !== '0.00') {
          accessoryLine += `<strong>מחיר:</strong> <span class="currency">${accessory.price}₪</span>`;
        }
        
        if (accessoryLine) {
          html += `<p class="profile-field">${accessoryLine}</p>\n`;
        }
      });
      
      html += `</div>\n\n`;
    }
    
    // פרופילים לא PCB
    const nonPcbProfiles = order.profiles ? order.profiles.filter(p => p.skipped_reason === 'not_pcb_profile') : [];
    if (nonPcbProfiles.length > 0) {
      html += `<div class="non-pcb-section">\n`;
      html += `<div class="section-title non-pcb-title">🔧 פרופילים נוספים בהזמנה - ללא PCB</div>\n`;
      
      nonPcbProfiles.forEach(profile => {
        if (profile.name && profile.name !== 'UNSURE') {
          html += `<p class="profile-field"><strong>שם:</strong> ${profile.name} <strong>הערה:</strong> <span class="highlight-value">לא PCB - יש לבדוק ידנית</span></p>\n`;
        }
      });
      
      html += `</div>\n\n`;
    }
    
    // הערות של האייג'נט
    html += `<div class="ai-notes-section">\n`;
    html += `<div class="section-title ai-notes-title">🧠 הערות נוספות של האייג'נט על ההזמנה</div>\n`;
    
    // בנה רשימת הערות חכמות
    const aiNotes = [];
    
    // בדוק גרונג
    const grooveProfiles = order.profiles ? order.profiles.filter(p => 
      p.groove_direction && p.groove_direction !== 'UNSURE' && p.groove_direction !== 'לא גרונג'
    ) : [];
    
    if (grooveProfiles.length > 0) {
      aiNotes.push('לפי הסקיצה זיהיתי שאחד מהפרופילים הוא בתצורת גרונג');
      aiNotes.push('יש לוודא סקיצה לפני הכנת דף עבודה');
    }
    
    // בדוק פרופילים לא PCB
    if (nonPcbProfiles.length > 0) {
      aiNotes.push('ישנם פרופילים לא מסוג PCB בהזמנה - יש לוודא ידנית');
    }
    
    // בדוק שדות חסרים כלליים
    const allMissingFields = new Set();
    if (order.profiles) {
      order.profiles.forEach(profile => {
        if (profile.missing_fields) {
          profile.missing_fields.forEach(field => allMissingFields.add(field));
        }
      });
    }
    
    if (allMissingFields.size > 0) {
      aiNotes.push(`זוהו שדות חסרים: ${Array.from(allMissingFields).join(', ')}`);
    }
    
    // בדוק משלוח
    if (order.delivery && order.delivery.is_required === true) {
      aiNotes.push('זוהתה דרישת משלוח ללקוח');
      if (order.delivery.address) {
        aiNotes.push(`כתובת משלוח: ${order.delivery.address}`);
      }
    }
    
    // הערות ברירת מחדל
    if (aiNotes.length === 0) {
      aiNotes.push('כל המידע חולץ אוטומטית מהמסמכים המצורפים');
      aiNotes.push('נא לאמת נכונות הפרטים לפני ביצוע ההזמנה');
    }
    
    // הדפס הערות
    aiNotes.forEach(note => {
      html += `<div class="ai-note">${note}</div>\n`;
    });
    
    html += `</div>\n\n`;
    
  });

  return html;
}

// פונקציה עם CSS מעוצב כמו בתמונה - מעודכן עם RTL
function generateFullOrderHTML(orderData, nameRivhitNO = null, client_name = null, rivhitNO = null) {
  const css = `
<style>
  body { 
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif; 
    line-height: 1.5; 
    margin: 20px auto; 
    max-width: 800px; 
    background-color: #f8f9fa;
    color: #333;
    direction: rtl;
    text-align: right;
  }
  
  .container {
    background: white;
    border-radius: 12px;
    padding: 30px;
    box-shadow: 0 2px 20px rgba(0,0,0,0.1);
    margin: 20px 0;
  }
  
  h2 { 
    color: #2c3e50; 
    text-align: center;
    font-size: 24px;
    margin-bottom: 30px;
    padding: 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border-radius: 8px;
    box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
  }
  
  .order-info {
    background: #f8f9ff;
    padding: 20px;
    border-radius: 8px;
    margin-bottom: 25px;
    border-right: 4px solid #3498db;
    direction: rtl;
    text-align: right;
  }
  
  .profile-section {
    background: #f0fff4;
    padding: 20px;
    border-radius: 8px;
    margin: 20px 0;
    border-right: 4px solid #27ae60;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    direction: rtl;
    text-align: right;
  }
  
  .profile-title {
    color: #27ae60;
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    direction: rtl;
    text-align: right;
  }
  
  .accessories-section {
    background: #fff8f0;
    padding: 20px;
    border-radius: 8px;
    margin: 20px 0;
    border-right: 4px solid #f39c12;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    direction: rtl;
    text-align: right;
  }
  
  .non-pcb-section {
    background: #f5f5f5;
    padding: 20px;
    border-radius: 8px;
    margin: 20px 0;
    border-right: 4px solid #95a5a6;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    direction: rtl;
    text-align: right;
  }
  
  .ai-notes-section {
    background: #f0f8ff;
    padding: 20px;
    border-radius: 8px;
    margin: 20px 0;
    border-right: 4px solid #3498db;
    box-shadow: 0 2px 8px rgba(0,0,0,0.05);
    direction: rtl;
    text-align: right;
  }
  
  .section-title {
    font-size: 18px;
    font-weight: bold;
    margin-bottom: 15px;
    display: flex;
    align-items: center;
    color: #2c3e50;
    direction: rtl;
    text-align: right;
  }
  
  .accessories-title { color: #f39c12; }
  .non-pcb-title { color: #95a5a6; }
  .ai-notes-title { color: #3498db; }
  
  p { 
    margin: 8px 0; 
    font-size: 14px;
  }
  
  strong { 
    color: #2c3e50; 
    font-weight: 600;
  }
  
  .profile-field {
    margin: 6px 0;
    padding: 4px 0;
  }
  
  .highlight-value {
    color: #e74c3c;
    font-weight: bold;
  }
  
  .currency {
    color: #27ae60;
    font-weight: bold;
  }
  
  .missing-fields {
    color: #e74c3c;
    font-style: italic;
  }
  
  .ai-note {
    margin: 8px 0;
    padding-right: 15px;
    position: relative;
    direction: rtl;
    text-align: right;
  }
  
  .ai-note::before {
    content: "•";
    color: #3498db;
    font-weight: bold;
    position: absolute;
    right: 0;
  }
</style>
`;
  
  return css + '<div class="container">' + generateStyledOrderHTML(orderData, nameRivhitNO, client_name, rivhitNO) + '</div>';
}

// Helper function to determine file type
function getFileType(filename) {
  if (!filename) return 'unknown';
  const ext = filename.toLowerCase().split('.').pop();
  const fileTypes = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
  return fileTypes[ext] || 'application/octet-stream';
}

// Main API endpoint - flexible file handling
app.post('/api/analyze-order', async (req, res) => {
  try {
    const { attachments, email_subject, email_body, sender_email, "name&rivhitNO": nameRivhitNO, client_name, rivhitNO } = req.body;

    // Log incoming request
    console.log('Received order analysis request:', {
      attachments_count: attachments ? attachments.length : 0,
      email_subject: email_subject,
      sender: sender_email
    });

    // Prepare messages for Claude
    const messages = [
      {
        role: 'assistant',
        content: SYSTEM_PROMPT
      },
      {
        role: 'assistant',
        content: CATALOG_NUMBERS
      },
      {
        role: 'assistant',
        content: PCB_PROFILES_TABLE
      },
      {
        role: 'assistant',
        content: GROOVE_GUIDE
      }
    ];

    // Prepare user message
    const userContent = [
      {
        type: 'text',
        text: `The following text was extracted from a supplier's email order.
Please:
1. Extract all relevant information from the attached files and email content.
2. Return a structured JSON object with English field names and original Hebrew values.
3. Analyze ALL attached files - PDFs, images, and any other documents.
4. If multiple orders are found across different files, include them all.

Email Subject: ${email_subject || 'No subject'}
Email Body: ${email_body || 'No body'}
Sender: ${sender_email || 'Unknown sender'}

Attached files analysis:`
      }
    ];

    // Process all attachments
    let pdfCount = 0;
    let imageCount = 0;
    let otherCount = 0;

    if (attachments && attachments.length > 0) {
      for (const attachment of attachments) {
        const { data, filename } = attachment;
        
        if (!data || !filename) {
          console.warn('Skipping attachment with missing data or filename');
          continue;
        }

        const fileType = getFileType(filename);
        const base64Data = typeof data === 'string' ? data : data.toString('base64');

        // Handle different file types
        if (fileType === 'application/pdf') {
          pdfCount++;
          userContent.push({
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Data
            }
          });
          console.log(`Added PDF: ${filename}`);
        } 
        else if (fileType.startsWith('image/')) {
          imageCount++;
          userContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: fileType,
              data: base64Data
            }
          });
          console.log(`Added image: ${filename}`);
        }
        else {
          // For other file types, add as text description
          otherCount++;
          userContent[0].text += `\n\nNote: File "${filename}" (${fileType}) was attached but cannot be directly processed. Please consider any references to this file in the email body.`;
          console.log(`Noted other file type: ${filename} (${fileType})`);
        }
      }

      // Add summary to prompt
      userContent[0].text += `\n\nTotal attachments processed: ${pdfCount} PDFs, ${imageCount} images, ${otherCount} other files.`;
    } else {
      // No attachments - try to extract from email body only
      userContent[0].text += `\n\nNo attachments found. Please extract any order information from the email body text above.`;
    }

    // Add user message to messages array
    messages.push({
      role: 'user',
      content: userContent
    });

    // Call Claude API
    console.log('Calling Claude API...');
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 8192,
      temperature: 1,
      messages: messages
    });

    // Extract JSON from Claude's response
    const responseText = response.content[0].text;
    let orderData;
    
    try {
      // Try to extract JSON from the response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        orderData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      return res.status(500).json({
        success: false,
        error: 'Failed to parse AI response',
        raw_response: responseText
      });
    }

    // Generate HTML output - רק אם יש פרמטרי לקוח
    let htmlOutput = null;
    if (nameRivhitNO || (client_name && rivhitNO)) {
      htmlOutput = generateFullOrderHTML(orderData, nameRivhitNO, client_name, rivhitNO);
    }

    // Return the analysis result with conditional HTML
    const response = {
      success: true,
      data: orderData,
      metadata: {
        processed_at: new Date().toISOString(),
        model_used: 'claude-3-5-sonnet-20241022',
        attachments_processed: {
          total: attachments ? attachments.length : 0,
          pdfs: pdfCount,
          images: imageCount,
          others: otherCount
        }
      }
    };

    // הוסף HTML רק אם יש פרמטרי לקוח
    if (htmlOutput) {
      response.html_output = htmlOutput;
    }

    // אם אין פרמטרי לקוח, הוסף שדות מפורקים
    if (!nameRivhitNO && !(client_name && rivhitNO) && orderData.orders && orderData.orders.length > 0) {
      const order = orderData.orders[0]; // השתמש בהזמנה הראשונה
      response.extracted_fields = {
        order_number: order.order_number || null,
        order_date: order.order_date || null,
        client_name: order.client_name || null,
        branch: order.branch || null
      };
    }

    res.json(response);

  } catch (error) {
    console.error('Error processing order:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Alternative endpoint for backward compatibility
app.post('/api/analyze-order-legacy', async (req, res) => {
  // Convert old format to new format
  const { pdf_data, pdf_name, img_data, img_name, email_subject, email_body, sender_email } = req.body;
  
  const attachments = [];
  if (pdf_data && pdf_name) {
    attachments.push({ data: pdf_data, filename: pdf_name });
  }
  if (img_data && img_name) {
    attachments.push({ data: img_data, filename: img_name });
  }

  // Forward to main endpoint
  req.body = { attachments, email_subject, email_body, sender_email };
  return app._router.handle(req, res);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'nisko-order-analyzer',
    version: '2.0',
    features: ['multi-file', 'flexible-input', 'pdf', 'images']
  });
});

// Test endpoint
app.post('/api/test', (req, res) => {
  const { attachments } = req.body;
  res.json({
    received: true,
    attachments_count: attachments ? attachments.length : 0,
    attachments_info: attachments ? attachments.map(a => ({
      filename: a.filename,
      has_data: !!a.data,
      data_length: a.data ? a.data.length : 0
    })) : []
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'Nisko Order Analysis API',
    version: '2.0',
    endpoints: {
      health: 'GET /health',
      analyze: 'POST /api/analyze-order',
      test: 'POST /api/test'
    }
  });
});

// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Nisko Order Analysis Server v2.0 running on port ${PORT}`);
  console.log('Features: Multi-file support, flexible attachment handling');
});

module.exports = app;
