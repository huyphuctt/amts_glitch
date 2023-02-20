const express = require('express');
const cheerio = require('cheerio');
const cors = require('cors')({ origin: true });
const compression = require('compression');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const axios = require('axios');

const TEMPLATES = require('./templates.json');
const { isset, isURL, substr_count, getUserAgent, checkCategory, checkExclude, in_array, explode, implode, replaceAll, trim } = require('./utils');
const { Iconv } = require('iconv');
const { detect, convert } = require('encoding-japanese');
const Request = require("request");
const iconv = require('iconv-lite');
const htmlToText = require('html-to-text');
const zlib = require('zlib');
const BodyParser = require('body-parser');

const PORT = process.env.PORT || 5001;

const _ERR_SUCCESS_ = 'success';
const _ERR_WARNING_ = 'warning';
const _ERR_ERROR_ = 'error';
const _ERR_INFO_ = 'info';

const _CALLBACK_TYPE_SEARCH_ = 'callback_search';
const _CALLBACK_TYPE_FILTER_ = 'callback_filter';
const _CALLBACK_TYPE_ANALYZE_ = 'callback_analyze';

const _ENGINE_GOOGLE_SEARCH_ = 'google_search';
const _ENGINE_GOOGLE_API_ = 'google_api';
const _ENGINE_RAPID_API_ = 'rapid_api';

const GOOGLE_PARAMS = [
    'as_epq', 'as_eq',
    'filter', 'gl',
    'hl', 'hq',
    'as_lq', 'as_filetype',
    'lowRange', 'highRange',
    'lr',
    'orTerms', 'as_rq',
    'as_rights', 'safe', 'searchType',
    'as_sitesearch', 'siteSearchFilter',
    'cr', 'start'
];

const GENERAL_PHONE_REGEX = /(\+\d{1,3}\s?)?((\(\d{3}\)\s?)|(\d{3})(\s|-?))(\d{3}(\s|-?))(\d{4})(\s?(([E|e]xt[:|.|]?)|x|X)(\s?\d+))?/gmiu;
//const EXT_PHONE_REGEX = /[\(\+[0-9]+]? [(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6} ext.[0-9]+/gmui;
const EMAIL_REGEX = /(^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)/gmui;


const _HTTP_OK_ = 200;
const _HTTP_NOT_FOUND_ = 400;
const _HTTP_ERROR_ = 500;
const _HTTP_INVALID_SSL_ = 600;
/**
 * Get html/json data from url
 */

function error($url, $err) {
    if (isset($err.response) && isset($err.response.status)) {
        return { 'code': $err.response.status, 'msg': $err.message };
    } else {
        console.log($url + " - " + $err.code + ": " + $err.message);
        switch ($err.code) {
            case 'ERR_TLS_CERT_ALTNAME_INVALID':
            case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE': {
                return { 'code': _HTTP_INVALID_SSL_, 'msg': $err.message };
            }
            default: {
                return { 'code': _HTTP_NOT_FOUND_, 'msg': $err.message };
            }
        }
    }
}

function performGet($url) {
    var prm = new Promise((resolve, reject) => {
        var $requestOptions = {
            encoding: null,
            method: "GET",
            rejectUnauthorized: false,
            uri: $url,
            timeout: 10000
        };
        Request($requestOptions, function ($err, response, body) {
            if ($err) {
                var $ret = error($url, $err);
                resolve($ret);
            } else {
                var utf8String = '';
                var detected = detect(body);
                if (detected != 'UTF8') {
                    var sjisArray = convert(body, 'UTF8', detected);
                    utf8String = iconv.decode(Buffer.from(sjisArray), "UTF8");
                } else {
                    utf8String = iconv.decode(Buffer.from(body), "UTF8");
                }
                resolve({ 'code': 200, 'data': utf8String });
            }
        });
    });
    return prm.then((value) => {
        return value;
    });
}
function performApiCall($url, $headers = {}) {
    var prm = new Promise((resolve, reject) => {
        var $requestOptions = {
            method: "GET",
            rejectUnauthorized: false,
            url: $url,
            headers: $headers
        };
        Request($requestOptions, function ($err, $res, $body) {
            if ($err) {
                var $ret = error($url, $err);
                resolve($ret);
            } else {
                resolve({ code: 200, data: $body, headers: $res.headers });
            }
        });
    });
    return prm.then((value) => {
        return value;
    });
    /***
    var $headers = {};
    if ($randomUA) {
        $headers = {
            'User-Agent': getUserAgent('desktop'),
        }
    }
    return axios({
        method: 'get',
        url: $url,
        timeout: $timeout,
        headers: $headers
    }).then($res => {
        return { 'code': 200, 'data': $res.data };
    }).catch($err => {
        $ret = error($err);
        return $ret;
    });
    */
}

/**
 * Post body to url
 */
function performPost(url, body) {
    var prm = new Promise((resolve, reject) => {
        var $requestOptions = null;
        if (url.includes('dev-')) {
            $requestOptions = {
                method: "POST",
                rejectUnauthorized: false,
                url: url,
                headers: {
                    'Content-Type': 'application/json',
                    'Cookie': 'XDEBUG_SESSION=XDEBUG_ECLIPSE'
                },
                body: JSON.stringify(body)
            };
        } else {
            $requestOptions = {
                method: "POST",
                rejectUnauthorized: false,
                url: url,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            };
        }
        Request($requestOptions, function ($err, $res, $body) {
            if ($err) {
                var $ret = error(url, $err);
                resolve($ret);
            } else {
                resolve({ code: 200, data: $body, headers: $res.headers });
            }
        });
    });
    return prm.then((value) => {
        return value;
    });
    /*
    return new Promise((resolve, reject) => {
        return axios.post(url, body)
    }).then(res => res.data
    ).catch(err => {
        Promise.reject(err.message);
    })*/
}

/**
 * Analyze url for data with templates
 */
async function analyze($aData, $runAsync) {
    var $contactForm = null;
    var $companyInfo = null;
    var $result = {};
    var $contact_form = null;
    var $company_info = null;
    if ($aData.templates && $aData.templates.contact_form) {
        $contact_form = $aData.templates.contact_form;
    } else {
        $contact_form = TEMPLATES.contact_form;
    }
    if ($aData.templates && $aData.templates.company_info) {
        $company_info = $aData.templates.company_info;
    } else {
        $company_info = TEMPLATES.company_info;
    }
    if (isset($aData.contact_url) && $aData.contact_url.length > 0 && $aData.contact_form == 1) {
        $contactForm = await template_analyze($aData.contact_url, $contact_form);
    }
    if (isset($aData.company_url) && $aData.company_url.length > 0 && $aData.company_info == 1) {
        $companyInfo = await pattern_analyze($aData.company_url, $company_info);
    }
    if ($contactForm != null || $companyInfo != null) {
        $result = { contact: $contactForm, company: $companyInfo };
    }

    $result.err = _ERR_SUCCESS_;
    $result.msg = '';
    var $callbackData = {
        "type": _CALLBACK_TYPE_ANALYZE_,
        "request": $aData,
        "response": $result
    };
    if ($runAsync) {
        var $callbackUrl = $aData.callback;
        if ($callbackUrl.length > 0) {
            let postContent = await performPost($callbackUrl, $callbackData);
            console.log(postContent);
        }
    } else {
        return $callbackData;
    }
}
/**
 * Analyze url for data with templates
 */
async function template_analyze($sUrl, $aTemplate, $runAsync) {
    var $getData = await performGet($sUrl);
    if ($getData.code == _HTTP_OK_) {
        var $html = $getData.data;
        var $info = {};
        var $ = cheerio.load($html);
        $aTemplate.forEach(template => {
            $info[template.type] = {};
            //check id first
            var $aId = template['id'].map(function (item) { return '[id$="' + item + '"]'; });
            var $sIds = $aId.join(',');
            if ($($sIds).length > 0) {
                $info[template.type].id = $($sIds).attr('id');
            }
            //then attr - name
            var $aName = template['attr'].name.map(function (item) { return '[name$="' + item + '"]'; });
            var $sNames = $aName.join(',');
            if ($($sNames).length > 0) {
                $info[template.type].name = $($sNames).attr('name');
            }
            //then attr - placeholder
            var $aPlaceHolder = template['attr'].placeholder.map(function (item) { return '[placeholder$="' + item + '"]'; });
            var $sPlaceHolders = $aPlaceHolder.join(',');
            if ($($sPlaceHolders).length > 0) {
                $info[template.type].placeholder = $($sPlaceHolders).attr('placeholder');
            }
            //check class last
            try {
                var $aClass = template['class'].map(function (item) { return '[class$="' + item + '"]'; });
                var $sClasss = $aClass.join(',');
                if ($($sClasss).length > 0) {
                    $info[template.type].class = $($sClasss).attr('class');
                }
            } catch (ex) {
            }
        });
        return $info;
    }
    return null;
}
async function pattern_analyze($sUrl, $aTemplate) {
    var $getData = await performGet($sUrl);
    if ($getData.code == _HTTP_OK_) {
        try {
            var $html = $getData.data;
            if ($html) {
                var $text = htmlToText.fromString($html);
                var $info = {};
                var $ = cheerio.load($html);
                $aTemplate.forEach(template => {
                    $info[template.type] = {};
                    //check id first
                    template['pattern'].forEach(pattern => {
                        if (substr_count($text, pattern) > 0) {
                            // debugger;
                            // console.log($text);
                            //$info[template.type].pattern = $($sClasss).attr('class');
                        }
                    });
                    // var $aPattern = template['pattern'].map(function (item) { return '[class$="' + item + '"]'; });
                    // var $sPattern = $aPattern.join(',');
                    // if ($($sPattern).length > 0) {
                    //     $info[template.type].class = $($sClasss).attr('class');
                    // }

                    /*var $aId = template['id'].map(function (item) { return '[id$="' + item + '"]'; });
                    var $sIds = $aId.join(',');
                    if ($($sIds).length > 0) {
                        $info[template.type].id = $($sIds).attr('id');
                    }
                    //then attr - name
                    var $aName = template['attr'].name.map(function (item) { return '[name$="' + item + '"]'; });
                    var $sNames = $aName.join(',');
                    if ($($sNames).length > 0) {
                        $info[template.type].name = $($sNames).attr('name');
                    }
                    //then attr - placeholder
                    var $aPlaceHolder = template['attr'].placeholder.map(function (item) { return '[placeholder$="' + item + '"]'; });
                    var $sPlaceHolders = $aPlaceHolder.join(',');
                    if ($($sPlaceHolders).length > 0) {
                        $info[template.type].placeholder = $($sPlaceHolders).attr('placeholder');
                    }
                    //check class last
                    try {
                        var $aClass = template['class'].map(function (item) { return '[class$="' + item + '"]'; });
                        var $sClasss = $aClass.join(',');
                        if ($($sClasss).length > 0) {
                            $info[template.type].class = $($sClasss).attr('class');
                        }
                    } catch (ex) {
                    }*/
                });
            }
            return $info;
        } catch (error) {
            console.log(error);
        }

    }
    return null;
}

async function filter($aData, $runAsync) {
    var $url = $aData.url;
    var $aContactTemplate = [];
    var $aCompanyTemplate = [];
    var $result = { 'url': $url };
    if (typeof $aData.templates == 'object') {
        $aContactTemplate = $aData.templates.contact_url;
        $aCompanyTemplate = $aData.templates.company_url;
    } else {
        $aContactTemplate = TEMPLATES.contact_url;
        $aCompanyTemplate = TEMPLATES.company_url;
    }
    if (!isURL($url)) {
        $result.err = _ERR_ERROR_;
        $result.msg = 'Invalid URL! ' + $url;
        $result.data = $aData;
    } else {
        try {
            var $aContactTemplateHref = $aContactTemplate.map(function (item) { return '[href$="' + item + '"]'; });
            var $aCompanyTemplateHref = $aCompanyTemplate.map(function (item) { return '[href$="' + item + '"]'; });
            var $sContactTemplate = $aContactTemplateHref.join(',');
            var $sCompanyTemplate = $aCompanyTemplateHref.join(',');
            var $aFaviconTemplateLink = TEMPLATES.favicon.join(',');
            console.log("Loading url " + $url);
            var $getData = await performGet($url);
            if ($getData.code == _HTTP_OK_) {
                var $html = $getData.data;

                var $ = cheerio.load($html);
                $result.err = _ERR_SUCCESS_;
                $result.code = _HTTP_OK_;
                $result.msg = "200 OK";
                $result.title = $('title').length ? $('title').text().trim() : "";
                var $language = $('html').attr("lang");
                if (isset($language)) {
                    $result.language = trim($language, 8);
                }
                var $logoUrl = '';
                if ($($aFaviconTemplateLink).length > 0) {
                    var $favicon = $($aFaviconTemplateLink).attr("href");
                    if (isset($favicon)) {
                        $logoUrl = $favicon.trim();
                    }
                }
                if ($('meta[name=keywords],meta[name=Keywords]').length > 0) {
                    var $keywords = $('meta[name=keywords],meta[name=Keywords]').attr("content");
                    if (isset($keywords)) {
                        $result.keywords = trim($keywords, 200);
                    }
                }
                if ($('meta[name=description],meta[name=Description]').length > 0) {
                    var $description = $('meta[name=description],meta[name=Description]').attr("content");
                    if (isset($description)) {
                        $result.description = trim($description, 200)
                    }
                }
                var $contactUrl = '';
                if ($($sContactTemplate).length > 0) {
                    var $contact = $($sContactTemplate).attr("href");
                    if (isset($contact)) {
                        $contactUrl = $contact.trim();
                    }
                }
                var $aHeading = $('h1, h2, h3, h4');
                var $aHeadingText = [];
                $aHeading.each(function (ixd, value) {
                    var $text = $(value).text();
                    if (typeof $text != 'undefined' && $text != null) {
                        $text = replaceAll('\n', '', $text);
                        $text = replaceAll('\t', '', $text);
                        $text = replaceAll('  ', '', $text);
                        $text = trim($text, 200);
                        if ($text.length > 0) {
                            $aHeadingText.push($text);
                        }
                    }
                });
                if ($aHeadingText.length > 0) {
                    $result.heading = trim($aHeadingText.join('\n'), 200);
                }
                var $companyUrl = '';
                var $ssss = $($sCompanyTemplate);
                if ($($sCompanyTemplate).length > 0) {
                    var $company = $($sCompanyTemplate).attr("href");
                    if (isset($company)) {
                        $companyUrl = $company.trim();
                    }
                }
                if ($logoUrl.length > 0) {
                    if ($logoUrl.startsWith("/")) {
                        $logoUrl = $url + $logoUrl;
                    } else if ($logoUrl.startsWith("http://") == false && $logoUrl.startsWith("https://") == false) {
                        $logoUrl = $url + "/" + $logoUrl;
                    }
                    $result.logo_url = $logoUrl.trim();
                }
                if ($contactUrl.length > 0) {
                    if ($contactUrl.startsWith("/")) {
                        $contactUrl = $url + $contactUrl;
                    } else if ($contactUrl.startsWith("http://") == false && $contactUrl.startsWith("https://") == false) {
                        $contactUrl = $url + "/" + $contactUrl;
                    }
                    $result.contact_url = $contactUrl.trim();
                }
                if ($companyUrl.length > 0) {
                    if ($companyUrl.startsWith("/")) {
                        $companyUrl = $url + $companyUrl;
                    } else if ($companyUrl.startsWith("http://") == false && $companyUrl.startsWith("https://") == false) {
                        $companyUrl = $url + "/" + $companyUrl;
                    }
                    $result.company_url = $companyUrl.trim();
                }

                var $aMatchPhoneGeneral = $html.match(GENERAL_PHONE_REGEX);
                if ($aMatchPhoneGeneral != null) {
                    var $aUniquePhone = new Set($aMatchPhoneGeneral);
                    $aMatchPhoneGeneral = Array.from($aUniquePhone);
                }
                var $aMatchEmail = $html.match(EMAIL_REGEX);
                if ($aMatchEmail != null) {
                    var $aUniqueEmail = new Set($aMatchEmail);
                    $aMatchEmail = Array.from($aUniqueEmail);
                }
                if ((isset($aMatchPhoneGeneral) && $aMatchPhoneGeneral.length > 0) ||
                    (isset($aMatchEmail) && $aMatchEmail.length > 0)) {
                    $result.homepage = { phone: $aMatchPhoneGeneral, email: $aMatchEmail };
                }
                var $oCheckCategoryData = {};
                $oCheckCategoryData.title = $result.title;
                if (isset($aData.snippet)) {
                    $oCheckCategoryData.snippet = $aData.snippet;
                }
                $oCheckCategoryData.meta_title = $result.title;
                $oCheckCategoryData.meta_description = $result.description;
                $oCheckCategoryData.meta_keywords = $result.keywords;
                $oCheckCategoryData.heading = $result.heading;
                var $sCategories = ';';
                var $sIndustries = ';';
                var categories = [];
                if ($aData.categories && $aData.categories.length > 0) {
                    categories = $aData.categories
                } else if ($aData.category_ids) {
                    var category_ids = $aData.category_ids.split(';');
                    TEMPLATES.categories.forEach(category => {
                        if (category_ids.includes(category.category_id)) {
                            categories.push(category);
                        }
                    });
                }
                // if (typeof TEMPLATES.categories == 'object') {
                var $aCat = [];
                var $aInd = [];
                categories.forEach($category => {
                    var $count = checkCategory($category, $oCheckCategoryData);
                    if ($count > 0) {
                        $aCat.push($category.category_id + ":" + $count);
                        if (!in_array($category.industry_id, $aInd)) {
                            $aInd.push($category.industry_id);
                        }
                    }
                });
                if ($aCat.length > 0 && $aInd.length > 0) {
                    $aCat.sort(function (sA, sB) {
                        var arrA = explode(':', sA);
                        var aCount = parseInt(arrA[1]);
                        var arrB = explode(':', sB);
                        var bCount = parseInt(arrB[1]);
                        return bCount - aCount;
                    });
                    $sCategories = ';' + $aCat.join(';') + ';';
                    $sIndustries = ';' + $aInd.join(';') + ';';
                }
                $result.category_ids = $sCategories;
                $result.industry_ids = $sIndustries;
                // }
            } else {
                $result.err = _ERR_ERROR_;
                $result.code = $getData.code;
                $result.msg = $getData.msg;
            }
        } catch (err) {
            $result.err = _ERR_ERROR_;
            $result.code = _HTTP_ERROR_;
            $result.msg = err.message;
        }
    }
    if ($runAsync) {
        var $callbackUrl = $aData['callback'];
        if ($callbackUrl.length > 0) {
            var $callbackData = {
                "type": _CALLBACK_TYPE_FILTER_,
                "request": $aData,
                "response": $result
            };
            let postContent = await performPost($callbackUrl, $callbackData);
            console.log(postContent);
        }
    } else {
        return $result;
    }
}
/***
 * Perform Google Web search
 **/
async function googleSearch($aData) {
    var $aParam = [];
    var $oKeyword = $aData.keyword;
    //var $sKeyword = encodeURIComponent($oKeyword.keyword);
    var $sKeyword = $oKeyword.keyword;
    var $sSite = trim($oKeyword.site);
    var $oTask = $aData.task;

    if ($oTask.exact == 1) {
        $aParam.push("as_epq=" + $sKeyword);
    } else {
        $aParam.push("q=" + $sKeyword);
    }
    $aParam.push("num=100");
    $aParam.push("start=" + $oKeyword.start);

    // cr - countries
    if($oTask){
        if ($oTask.countries && $oTask.countries.length > 0) {
            var $countries = $oTask.countries.map(function (item) { return 'country' + item; });
            $aParam.push("cr=" + implode(' ', $countries));
        }
        // as_epq : exact
  
  
        // as_eq - excludes:(15) ['パソコンショップ', 'パソコン修理', 'パソコンレンタル', 'パソコンレンタル', 'パソコン販売', '-hnavi', '-news', '-blog', '-magazine', '-facebook', '-social', '-amazon', '-yahoo', '-academy', '-lancers']
        if ($oTask.excludes && $oTask.excludes.length > 0) {
            $aParam.push("as_eq=" + implode(' ', $oTask.excludes));
        }
        // lr: languages
        if ($oTask.languages && $oTask.languages.length > 0) {
            $aParam.push("lr=" + implode(' ', $oTask.languages));
        }
    }
    // as_sitesearch: site
    // if ($oTask.site.length > 0) {
    if ($sSite.length > 0) {
        $aParam.push("as_sitesearch=" + $sSite);
    }

    var $query = $aParam.join("&");
    $query = encodeURI($query);
    var $sUrl = "https://www.google.com/search?" + $query;
    var $getData = await performGet($sUrl);
    if ($getData.code == _HTTP_OK_) {
        var $ = cheerio.load($getData.data);
        var $aLink = $('a');
        var $aUrl = [];
        var $aDomain = [];
        $aLink.each(function (ixd, value) {
            var $url = $(value).attr('href');
            if (substr_count($url, '/url?q=') > 0 && substr_count($url, 'google.') == 0) {
                $url = $url.replace('/url?q=', '');
                var $arr = $url.split("/");
                var $domain = $arr[0] + '//' + $arr[2];
                if (!in_array($domain, $aDomain)) {
                    $aDomain.push($domain);
                    $aUrl.push({ 'link': $url });
                }
            }
        });
        var $headers = { total: $aUrl.length, finish: false };
        if ($aUrl.length < 75) {
            //ket thuc cho tu khoa nay
            $headers.finish = true;
        }
        return { code: $getData.code, data: $aUrl, headers: $headers, url: $sUrl };
    } else {
        return { code: $getData.code, data: $getData.msg, headers: null, url: $sUrl };
    }
    //"https://www.google.com/search?q=WEB%E3%82%B7%E3%82%B9%E3%83%86%E3%83%A0%E9%96%8B%E7%99%BA&num=100";
}

/***
 * Perfomr Google Search API call
 **/
async function googleApiSearch($aData) {
    var $sApiKey = $aData['apikey'];
    var $sEngine = $aData['engine'];
    var $aExclude = $aData['exclude'];
    var $sKeyword = encodeURIComponent($aData['keyword']);
    var $nStartIndex = $aData['start'];
    var $sLanguage = $aData['lang'];
    var $sExclude = '';
    var $response = {};
    if ($aExclude.length > 0) {
        var $aAllSite = [];
        $aExclude.forEach($exclude => {
            var $aSite = $exclude.detail.split(",");
            var $aSiteFiltered = [];
            $aSite.forEach($site => {
                if (substr_count($site, "*") < 2) {
                    if (substr_count($site, "*.") > 0 || substr_count($site, ".*") > 0) {
                        $aSiteFiltered.push($site.trim());
                    }
                }
            });
            if ($aSiteFiltered.length > 0) {
                $aAllSite = $aAllSite.concat($aSiteFiltered);
            }
        });
        $aAllSite.sort();
        $sExclude = $aAllSite.join(" ");
    }
    console.log("Begin search for '" + $aData['keyword'] + "' " + $nStartIndex + " - " + $sLanguage);
    var $sApiUrl = "https://www.googleapis.com/customsearch/v1?key=" + $sApiKey;
    $sApiUrl += "&cx=" + $sEngine;
    $sApiUrl += "&q=" + $sKeyword;
    $sApiUrl += "&start=" + $nStartIndex;
    if ($sExclude.length > 0) {
        $sApiUrl += "&siteSearchFilter=e";
        $sApiUrl += "&siteSearch=" + $sExclude;
    }
    $sApiUrl += "&lr=" + $sLanguage;
    try {
        var $getData = await performApiCall($sApiUrl, true);
        if ($getData.code == _HTTP_OK_) {
            $response = $getData.data;
            var $result = {};
            $result.search = [];
            $result.filter = [];
            var $aExcluded = [];
            if (typeof $response.items == 'object') {
                var $aResult = [];
                for (let index = 0; index < $response.items.length; index++) {
                    const $item = $response.items[index];
                    var $sUrl = '';
                    var $sScheme = '';
                    var $sLink = $item['link'];
                    var $arr = $sLink.split("/");
                    if ($arr.length > 2) {
                        $sUrl = $arr[0] + '//' + $arr[2];
                    } else {
                        var $sDisplayLink = $item['displayLink'];
                        if ($sLink.includes('https://')) {
                            $sScheme = "https://";
                        } else {
                            $sScheme = "http://";
                        }
                        $sUrl = $sScheme + $sDisplayLink;
                    }
                    $result.search.push($sUrl);

                    if (checkExclude($item['link'], $aExclude) == false) {
                        $aExcluded.push($item);
                        $result.filter.push($sUrl);
                    }
                }
                $result.err = _ERR_SUCCESS_;
                $response.logs = $result;
                $response.items = $aExcluded;
                console.log("return " + $aExcluded.length + " for '" + $aData['keyword'] + "'");
            }
        } else {
            console.log("Result search error '" + $aData['keyword'] + "' " + $nStartIndex + " - " + $sLanguage + ": " + $getData.msg);
            $response.logs = { 'err': _ERR_WARNING_, 'code': $getData.code, 'msg': $getData.msg };
        }
    } catch (err) {
        console.log("Result search error '" + $aData['keyword'] + "' " + $nStartIndex + " - " + $sLanguage + ": " + err.message);
        $response.logs = { 'err': _ERR_ERROR_, 'msg': err.message };
    }
    $response.apiCall = $sApiUrl;
    return $response;
}

/***
 * Perform RapidAPI call
 * @param $aData : input data contains
 * apikey : Rapid API Key
 * keyword(q)
 * exactTerms OPT
 * excludeTerms OPT
 * country(cr) OPT : countryJP, countryVN,...
 * language(lr) : lang_en, lang_ja, lang_vi
 * start 0, 100, 200, ...
 **/
async function rapidApiSearch($aData) {
    const $NUM = 100;//always 100 items
    var $start = $aData['start'];
    var $q = $aData['keyword'];
    var $sRapidApiKey = $aData['apikey'];
    var $lr = $aData['language'];
    var $cr = $aData['country'];
    var $aParam = [];
    $aParam.push("q=" + $q);
    $aParam.push("num=" + $NUM);
    if ($start > 0) {
        $aParam.push("start=" + $start);
    }
    if (isset($lr)) {
        $aParam.push("lr=" + $lr);
    }
    if (isset($cr)) {
        $aParam.push("cr=" + $cr);
    }
    var $query = $aParam.join("&");
    $query = encodeURIComponent($query);
    $query = encodeURIComponent($query);
    var $sApiUrl = 'https://google-search3.p.rapidapi.com/api/v1/search/' + $query;
    var $headers = {
        'x-rapidapi-host': 'google-search3.p.rapidapi.com',
        'x-rapidapi-key': $sRapidApiKey,
        'useQueryString': true
    }
    var $result = await performApiCall($sApiUrl, $headers)
    if ($result.code == _HTTP_OK_) {
        if (isset($result.data.results)) {
            return { code: $result.code, data: $result.data.results, headers: $result.headers, url: $sApiUrl };
        } else {
            return { code: _HTTP_NOT_FOUND_, data: $result.data, headers: $result.headers, url: $sApiUrl };
        }
    } else {
        return $result;
    }
}

/***
 * Perform search with Google web, Google search API or Rapid API
 * response format
 * {
 *  code: 200,
 *  data: [{
 *      "title": "WEBシステム開発 - ワークジェイ",
 *      "link": "https://www.work-j.com/business_guide/web_system.html",
 *      "description": "広島でホームページ制作ならワークジェイへご相談ください。ホームページ作成だけでなく、CMS（コンテンツ・マネジメント・システム）や独自のWebシステム開発、検索結果の上位表示を目指すSEO（検索エンジン最適化）など一体的に ..."
 *  }],
 *  headers:{
 *      "content-type": "application/json",
 *      "date": "Tue, 22 Sep 2020 08:13:57 GMT",
 *      "server": "RapidAPI-1.2.6",
 *      "x-rapidapi-region": "AWS - ap-southeast-1",
 *      "x-rapidapi-version": "1.2.6",
 *      "x-ratelimit-search-limit": "300",
 *      "x-ratelimit-search-remaining": "299",
 *      "content-length": "112",
 *      "connection": "Close",
 *      "total":100,
 *      "finish": false
 *  }
 * }
 ***/
async function search($aData, $runAsync) {
    var $response = {};
    var $apiResponse = null;
    if (!isset($aData.api)) {
        $response.logs = { 'err': _ERR_WARNING_, 'code': _HTTP_ERROR_, 'msg': 'Invalid search engine' };
    }
    // if ($aData.api.engine == _ENGINE_GOOGLE_SEARCH_) {
    $apiResponse = await googleSearch($aData);
    // } else if ($aData.api.engine == _ENGINE_RAPID_API_) {
    //     $apiResponse = await rapidApiSearch($aData);
    // } else if ($aData.api.engine == _ENGINE_GOOGLE_API_) {
    //     $apiResponse = await googleApiSearch($aData);
    // }
    if ($apiResponse.code == _HTTP_OK_) {
        var $aExclude = $aData['exclude'];
        var $items = $apiResponse.data;
        var $result = {};
        var $aExcluded = [];

        $response.headers = $apiResponse.headers;
        $result.search = [];
        $result.filter = [];
        if (typeof $items == 'object') {
            var $aResult = [];
            for (let index = 0; index < $items.length; index++) {
                const $item = $items[index];
                var $sUrl = '';
                var $sScheme = '';
                var $sLink = $item['link'];
                if (substr_count($sLink, 'http://') > 0 || substr_count($sLink, 'https://') > 0) {
                    var $arr = $sLink.split("/");
                    if ($arr.length > 2) {
                        $sUrl = $arr[0] + '//' + $arr[2];
                    } else if (isset($item['displayLink'])) {
                        var $sDisplayLink = $item['displayLink'];
                        if ($sLink.includes('https://')) {
                            $sScheme = "https://";
                        } else {
                            $sScheme = "http://";
                        }
                        $sUrl = $sScheme + $sDisplayLink;
                    }
                    if ($sUrl.length > 0) {
                        $result.search.push($sUrl);
                        console.log('checkExclude ' + $sUrl);
                        if (checkExclude($sUrl, $aExclude) == false) {
                            $aExcluded.push($item);
                            $result.filter.push($sUrl);
                        }
                    }
                }
            }
            $result.err = _ERR_SUCCESS_;
            $response.logs = $result;
            $response.items = $aExcluded;
            $response.apiCall = $apiResponse.url;
            console.log("return " + $aExcluded.length + " for '" + $aData['keyword'] + "'");
        }
    } else {
        //console.log("Result search error '" + $aData['keyword'] + "' " + $nStartIndex + " - " + $sLanguage + ": " + $getData.msg);
        $response.logs = { 'err': _ERR_WARNING_, 'code': $apiResponse.code, 'msg': $apiResponse.msg };
    }
    var $callbackData = {
        "type": _CALLBACK_TYPE_SEARCH_,
        "request": $aData,
        "response": $response
    };
    if ($runAsync) {
        var $callbackUrl = $aData['callback'];
        if ($callbackUrl.length > 0) {
            let postContent = await performPost($callbackUrl, $callbackData);
            console.log(postContent);
        }
    } else {
        return $callbackData;
    }
}

var app = express();
app.use(cors);
app.use(compression());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: false, limit: '50mb' }));
app.use(cookieParser());
app.use(helmet());

//default, do nothing
app.get('/', (_, res) => { res.json({ q: "Whatcha doin'?" }) })

/**
 * Filter website and search for contact page,
 * if contact page exist, searching for contact form 
 */
app.get('/filter', async (req, res) => {
    var $aParam = req.query;
    console.log('have sync filter');
    var $data = await filter($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data, req: $aParam })
});

app.post('/filter', async (req, res) => {
    var $aParam = req.body;
    if (!$aParam.callback) {
        $aParam = req.query;
    }
    console.log('have sync filter');
    var $data = await filter($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data, req: $aParam })
});

app.post('/async_filter', async (req, res) => {
    // var $aParam = req.body;

    console.log('have async filter');
    new Promise(function (resolve, reject) {
        var gunzip = zlib.createGunzip();
        // res.pipe(gunzip);
        const buffer = [];
        gunzip.on('data', function (data) {
            // Encoding the data
            // decompression chunk ready, add it to the buffer
            buffer.push(data.toString())
            console.log(buffer.length);
            try {
                var $aParam = JSON.parse(buffer.join(""));
                if ($aParam != null) {
                    filter($aParam, true);
                    console.log("async filter done");
                    resolve();
                }
            } catch (ex) {
            }
        });
        gunzip.write(req.body);
        // setTimeout(() => {
        //     filter($aParam, true);
        //     console.log("async filter done");
        //     resolve();
        // }, 100);
    });
    return res.status(200).json({ 'err': _ERR_SUCCESS_ })
});

//Google Custom search
app.get('/search', async (req, res) => {
    var $aParam = req.query;
    var $data = await search($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data })
});
app.post('/search', async (req, res) => {
    var $aParam = req.body;
    if (!$aParam.callback) {
        $aParam = req.query;
    }
    var $data = await search($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data })
});

app.post('/async_search', async (req, res) => {
    var $aParam = req.body;
    console.log('have async search');
    new Promise(function (resolve, reject) {
        setTimeout(() => {
            search($aParam, true);
            console.log("async search done");
            resolve();
        }, 100);
    });
    return res.status(200).json({ 'err': _ERR_SUCCESS_ })
});

//Analyze contact page
app.get('/analyze', async (req, res) => {
    var $aParam = req.query;
    var $data = await analyze($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data })
});
app.post('/analyze', async (req, res) => {
    var $aParam = req.body;
    var $data = await analyze($aParam, false);
    return res.status(200).json({ 'err': _ERR_SUCCESS_, data: $data })
});

app.post('/async_analyze', async (req, res) => {
    var $aParam = req.body;
    console.log('have async analyze');
    new Promise(function (resolve, reject) {
        setTimeout(() => {
            analyze($aParam, true);
            console.log("async analyze done");
            resolve();
        }, 100);
    });
    return res.status(200).json({ 'err': _ERR_SUCCESS_ })
});
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

function test() {
    var request = require("request");
    var options = {
        method: 'GET',
        url: 'https://google-search3.p.rapidapi.com/api/v1/search/q%253D3d%2520%25E3%2583%25A2%25E3%2583%2587%25E3%2583%25AA%25E3%2583%25B3%25E3%2582%25B0%2520vr%2526num%253D100',
        headers: {
            'x-rapidapi-host': 'google-search3.p.rapidapi.com',
            'x-rapidapi-key': 'adb6e9602amshafe610ec62c4e15p1f28f7jsn6f2dc09a9248',
            useQueryString: true
        }
    };


    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        console.log(body);
    });

}

function testSerpBot() {
    var request = require("request");

    var options = {
        method: 'GET',
        url: 'https://google-search5.p.rapidapi.com/google-serps/',
        qs: { pages: '1', q: '3D%E3%82%A4%E3%83%B3%E3%83%86%E3%83%AA%E3%82%A2' },
        headers: {
            'x-rapidapi-host': 'google-search5.p.rapidapi.com',
            'x-rapidapi-key': 'adb6e9602amshafe610ec62c4e15p1f28f7jsn6f2dc09a9248',
            useQueryString: true
        }
    };

    request(options, function (error, response, body) {
        if (error) throw new Error(error);

        console.log(body);
    });
}
// testSerpBot();
// performGet('https://www.s-p-net.com', true);
// Loading url https://qiita.com
// Loading url https://agent.evolable.asia