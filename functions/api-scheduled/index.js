const { Agent, setGlobalDispatcher } = require("undici");

// Node's fetch gives up after 5 minutes without response headers (UND_ERR_HEADERS_TIMEOUT).
// Some jobs take longer (the Vipps sync runs ~6 minutes), so they are bounded by the
// function's own 900 s timeout instead.
setGlobalDispatcher(new Agent({ headersTimeout: 0, bodyTimeout: 0 }));

/**
 * Responds to any HTTP request.
 *
 * @param {!express:Request} req HTTP request context.
 * @param {!express:Response} res HTTP response context.
 */
exports.default = async (req, res) => {
  // let message = req.query.message || req.body.message || 'Hello World!';

  try {
    // Fetch access token
    let response = await fetch("https://gieffektivt.eu.auth0.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"client_id":"${process.env.CLIENTID}","client_secret":"${process.env.CLIENTSECRET}","audience":"https://data.gieffektivt.no","grant_type":"client_credentials"}`,
    });

    if (response.status != 200) throw new Error("Could not get access token");

    response = await response.json();
    const token = response["access_token"];

    switch (req.query.type) {
      case "ocr":
        let ocrresponse = await fetch("https://data.gieffektivt.no/scheduled/ocr/", {
          method: "POST",
          headers: { authorization: "Bearer " + token },
        });
        if (ocrresponse.status !== 200) throw new Error("Failed to process OCR");
        res.send("OK");
        break;
      case "avtalegiro":
        let avtalegiroresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/avtalegiro/?notify=true",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (avtalegiroresponse.status !== 200) throw new Error("Failed to process avtalegiro");
        res.send("OK");
        break;
      case "avtalegiro_retry":
        let avtalegiroretryresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/avtalegiro/retry",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (avtalegiroretryresponse.status !== 200)
          throw new Error("Failed to process avtalegiro retry");
        res.send("OK");
        break;
      case "vipps":
        let vippsresponse = await fetch("https://data.gieffektivt.no/scheduled/vipps", {
          method: "POST",
          headers: { authorization: "Bearer " + token },
        });
        if (vippsresponse.status !== 200) throw new Error("Failed to process vipps");
        res.send("OK");
        break;
      case "vipps_sync":
        let vippssyncresponse = await fetch("https://data.gieffektivt.no/scheduled/vipps/sync", {
          method: "POST",
          headers: { authorization: "Bearer " + token },
        });
        if (vippssyncresponse.status !== 200) throw new Error("Failed to process vipps sync");
        res.send("OK");
        break;
      case "vipps_charges":
        let vippschargesresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/vipps/charges",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (vippschargesresponse.status !== 200) throw new Error("Failed to process vipps charges");
        res.send("OK");
        break;
      case "auth0check":
        let auth0checkresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/auth0/validateusers",
          { method: "GET", headers: { authorization: "Bearer " + token } },
        );
        if (auth0checkresponse.status !== 200) throw new Error("Failed to process auth0 check");
        res.send("OK");
        break;
      case "followup":
        let followupresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/initiate-follow-ups",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (followupresponse.status !== 200) throw new Error("Failed to process payment follow up");
        res.send("OK");
        break;
      case "mailchimp":
        let mailchimpresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/mailchimp/newsletter/sync",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (mailchimpresponse.status !== 200) throw new Error("Failed to process mailchimp");
        res.send("OK");
        break;
      case "exchangerates":
        let exchangeratesresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/exchange-rates",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (exchangeratesresponse.status !== 200)
          throw new Error("Failed to process exchange rates");
        res.send("OK");
        break;
      case "impactdiff":
        let impactdiffresponse = await fetch(
          "https://data.gieffektivt.no/scheduled/impact-compat-diff",
          { method: "POST", headers: { authorization: "Bearer " + token } },
        );
        if (impactdiffresponse.status !== 200)
          throw new Error("Failed to process impact compat diff");
        res.send("OK");
        break;
      default:
        res
          .status(400)
          .send(
            "Missing query parameter {type}, or invalid value (ocr, avtalegiro, avtalegiro_retry, vipps, vipps_sync, vipps_charges, auth0check, followup, mailchimp, exchangerates, impactdiff are allowed values)",
          );
    }
    return;
  } catch (ex) {
    console.error(ex);
    res.status(500).send("Failed to fet auth0 access token");
  }
};
