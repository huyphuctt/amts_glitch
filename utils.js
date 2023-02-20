const USER_AGENTS = require('./useragents.json');
/**
 * Determine if a variable is declared and is different than NULL
 * @param mixed $var 
 * @return bool
 */
function isset($var) {
    if (typeof $var == 'undefined') {
        return false;
    }
    return $var != null;
}
/***
 * Check item 
 * @param mixed $needle 
 * @param array $haystack
 * @return boolean
 **/
function in_array($needle, $haystack) {
    var idx = $haystack.indexOf($needle);
    return idx > -1;
}



/**
 * Join array elements with a string
 * @param string $glue
 * @param array $pieces
 * @return string
 */
function implode($glue, $pieces) {
    return $pieces.join($glue);
}

/**
 * Split a string by a string
 * @param string $delimiter
 * @param string $string
 * @return array
 */
function explode($delimiter, $string) {
    return $string.split($delimiter);
}

function trim($data, $len = 0) {
    if ($data == null) {
        return '';
    }
    var $out = $data.trim();
    if ($len > 0 && $out.length > $len) {
        $out = $out.substr(0, $len - 1);
        $out = $out.trim();
    }
    return $out;
}
/**
 * Count the number of substring occurrences
 * @param string $haystack
 * @param string $needle 
 * @param int $offset = 0 
 * @param int $length
 * @return int 
 */
function substr_count($haystack, $needle, $offset = 0, $length) {
    var $cnt = 0;
    $haystack += '';
    $needle += '';
    if (isNaN($offset)) {
        $offset = 0;
    }
    if (isNaN($length)) {
        $length = 0;
    }
    if ($needle.length === 0) {
        return 0;
    }
    $offset--;
    while (($offset = $haystack.indexOf($needle, $offset + 1)) !== -1) {
        if ($length > 0 && ($offset + $needle.length) > $length) {
            return 0;
        }
        $cnt++;
    }
    return $cnt;
}

/**
 * random_int — Generates cryptographically secure pseudo-random integers
 * @param int $max 
 * @return int
*/
function random_int($max) {
    $max = Math.floor($max);
    return Math.floor(Math.random() * $max);
}

function isURL(url) {
    var pattern = new RegExp('^(https?:\\/\\/)?' + // protocol
        '((([a-z\\d]([a-z\\d-]*[a-z\\d])*)\\.)+[a-z]{2,}|' + // domain name
        '((\\d{1,3}\\.){3}\\d{1,3}))' + // OR ip (v4) address
        '(\\:\\d+)?(\\/[-a-z\\d%_.~+]*)*' + // port and path
        '(\\?[;&a-z\\d%_.~+=-]*)?' + // query string
        '(\\#[-a-z\\d_]*)?$', 'i'); // fragment locator
    return !!pattern.test(url);
}

function checkCategory($oCategory, $oSite) {
    var $iCount = 0;
    var $aKeyword = $oCategory['keywords'].split(',');
    $aKeyword.forEach($sKeyword => {
        $sKeyword = trim($sKeyword);
        if (isset($oSite['title'])) {
            $iCount += substr_count($oSite['title'].toLowerCase(), $sKeyword.toLowerCase());
        }
        if (isset($oSite['snippet'])) {
            $iCount += substr_count($oSite['snippet'].toLowerCase(), $sKeyword.toLowerCase());
        }
        if (isset($oSite['meta_title'])) {
            $iCount += substr_count($oSite['meta_title'].toLowerCase(), $sKeyword.toLowerCase());
        }
        if (isset($oSite['meta_descrition'])) {
            $iCount += substr_count($oSite['meta_descrition'].toLowerCase(), $sKeyword.toLowerCase());
        }
        if (isset($oSite['meta_keywords'])) {
            $iCount += substr_count($oSite['meta_keywords'].toLowerCase(), $sKeyword.toLowerCase());
        }
        if (isset($oSite['heading'])) {
            $iCount += substr_count($oSite['heading'].toLowerCase(), $sKeyword.toLowerCase());
        }
    });
    return $iCount;
}

function replaceAll($search, $replace, $obj) {
    try {
        const replacer = new RegExp($search, 'g');
        return $obj.replace(replacer, $replace);
    } catch (ex) {
        return '';
    }
}

function checkExclude($sUrl, $aExclude) {
    var $arr = [];
    $aExclude.forEach($item => {
        var $sDetail = $item.detail;
        var $sText = $sDetail.replace(/\*/g, '');
        var $aText = $sText.split(",");
        $aText.forEach(element => {
            var $txt = element.trim();
            $arr.push($txt);
        });
    });
    var $sReg = "(" + $arr.join("|") + ")";
    var $regex = RegExp($sReg, "giu");
    var $aMatch = $sUrl.match($regex);
    return isset($aMatch) && $aMatch.length > 0;
}

function getUserAgent(type) {
    let group;
    let groupLists = [];
    let list = [];
    if (type) {
        group = USER_AGENTS.find((group) => group.type === type);
        groupLists = group.list;
    } else {
        USER_AGENTS.forEach((group) => {
            groupLists = groupLists.concat(group.list);
        });
    }

    groupLists.forEach((item) => {
        list = list.concat(item.useragents);
    });

    let n = random_int(list.length);

    return list[n].useragent;
};


module.exports = {
    //php ported
    isset,
    in_array,
    explode,
    implode,
    substr_count,
    trim,
    random_int,
    replaceAll,
    //utils
    isURL,
    checkCategory,
    checkExclude,
    getUserAgent,

}
