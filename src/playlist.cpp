// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

#include "animations.h"

// Played in this order by loop().
const Animation ANIMATIONS[] = {
    {"xmas_tree", xmas_tree},
    {"santa", santa},
    {"ball", ball},
    {"reindeer", reindeer},
    {"snowman", snowman},
    {"wreath", wreath},
    {"penguin", penguin},
    {"snow_trees", snow_trees},
    {"snowflake", snowflake},
    {"sleigh", sleigh},
    {"holly", holly},
    {"star", star},
    {"gingerbread_man", gingerbread_man},
    {"poinsettia", poinsettia},
    {"elf", elf},
    {"jumping_reindeer", jumping_reindeer},
    {"candy_cane", candy_cane},
    {"steaming_mug", steaming_mug},
    {"snow_globe", snow_globe},
    {"open_gift", open_gift},
    {"santa_hat", santa_hat},
    {"teddy_bear", teddy_bear},
    {"bell", bell},
    {"fireplace", fireplace},
    {"panettone", panettone},
    {"candle", candle},
    {"christmas_lights", christmas_lights},
    {"pine_ball", pine_ball},
    {"santa_bag", santa_bag},
    {"bear", bear},
};

const size_t ANIMATION_COUNT = sizeof(ANIMATIONS) / sizeof(ANIMATIONS[0]);
